import { describe, expect, it, vi } from "vitest";
import { LatestAudio, pcm16, resample } from "./stream";
import worklet from "../../public/audio/capture-worklet.js?raw";

describe("bounded audio and wire format", () => {
  it("retains only four seconds and skips to the newest window after slow work", () => {
    const audio = new LatestAudio(48000);
    audio.append(new Float32Array(48000 * 3));
    expect(audio.take()).toBeNull();
    audio.append(new Float32Array(48000));
    expect(audio.take()?.samples.length).toBe(153600);
    for (let i = 0; i < 10; i++) audio.append(new Float32Array(48000).fill(i));
    expect(audio.bufferedSeconds).toBe(4);
    const latest = audio.take()!;
    expect(latest.startSample).toBe(Math.round(10.8 * 16000));
    expect(latest.samples.at(-1)).toBe(9);
    expect(audio.take()).toBeNull();
  });
  it("requires fresh audio after a manual jump or a worklet delivery gap", () => {
    const audio = new LatestAudio(16000);
    audio.append(new Float32Array(51200));
    audio.take();
    audio.clear();
    audio.append(new Float32Array(16000));
    expect(audio.take()).toBeNull();
    audio.append(new Float32Array(1600), 200000);
    expect(audio.bufferedSeconds).toBe(0.1);
    expect(audio.take()).toBeNull();
  });
  it("encodes mono signed 16-bit little endian with clipping", () => {
    const view = new DataView(
      pcm16(new Float32Array([-2, -0.5, 0, 0.5, 2, NaN])),
    );
    expect(
      Array.from({ length: 6 }, (_, i) => view.getInt16(i * 2, true)),
    ).toEqual([-32768, -16384, 0, 16384, 32767, 0]);
    expect(view.getUint8(0)).toBe(0);
    expect(view.getUint8(1)).toBe(128);
  });
  it("gives the resampler the actual source rate and requests 16 kHz output", async () => {
    const calls: unknown[] = [];
    class Offline {
      destination = {};
      length: number;
      constructor(...args: unknown[]) {
        calls.push(args);
        this.length = args[1] as number;
      }
      createBuffer(ch: number, length: number, rate: number) {
        calls.push([ch, length, rate]);
        return { copyToChannel: vi.fn() };
      }
      createBufferSource() {
        return {
          buffer: null,
          connect: vi.fn(),
          start: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      async startRendering() {
        return { getChannelData: () => new Float32Array(this.length) };
      }
    }
    vi.stubGlobal("OfflineAudioContext", Offline);
    try {
      expect((await resample(new Float32Array(48000), 48000)).length).toBe(
        16000,
      );
      expect(calls).toEqual([
        [1, 16000, 16000],
        [1, 48000, 48000],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("backpressures worklet messages and averages stereo without accumulating queued chunks", () => {
    const messages: { samples: ArrayBuffer; endFrame: number }[] = [];
    let Capture: any;
    class Processor {
      port = {
        onmessage: null as null | (() => void),
        postMessage: (value: { samples: ArrayBuffer; endFrame: number }) =>
          messages.push(value),
      };
    }
    new Function(
      "AudioWorkletProcessor",
      "sampleRate",
      "registerProcessor",
      worklet,
    )(Processor, 16000, (_: string, klass: unknown) => {
      Capture = klass;
    });
    const node = new Capture();
    const channels = [
      new Float32Array(1600).fill(0.5),
      new Float32Array(1600).fill(-0.25),
    ];
    for (let i = 0; i < 50; i++) node.process([channels]);
    expect(messages).toHaveLength(1);
    expect(new Float32Array(messages[0].samples)[0]).toBe(0.125);
    node.port.onmessage();
    node.process([channels]);
    expect(messages).toHaveLength(2);
    expect(messages[1].endFrame).toBe(81600);
  });
});
