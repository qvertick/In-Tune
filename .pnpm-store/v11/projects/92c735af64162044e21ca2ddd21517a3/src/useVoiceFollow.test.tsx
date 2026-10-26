// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useVoiceFollow } from "./useVoiceFollow";
import { createSong } from "./model";

let node: any;
let audioCalls: {
  url: string;
  resolve: (value: Response) => void;
  body: ArrayBuffer;
}[];
let operations: string[];
const source = { connect: vi.fn(), disconnect: vi.fn() };
const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
const context = {
  sampleRate: 16000,
  audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
  createGain: () => gain,
  destination: {},
};
beforeEach(() => {
  audioCalls = [];
  operations = [];
  vi.clearAllMocks();
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
      onprocessorerror = null;
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        node = this;
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options?: RequestInit) => {
      operations.push((options?.method || "GET") + " " + url);
      if (url === "/api/follow/status")
        return Promise.resolve(
          Response.json({
            version: "0.3.45",
            models: {
              ru: {
                installed: true,
                name: "model",
                sizeMB: 45,
                command: "install",
              },
            },
          }),
        );
      if (url === "/api/follow/sessions")
        return Promise.resolve(Response.json({ id: "session-1" }));
      if (url.includes("/audio?"))
        return new Promise<Response>((resolve) =>
          audioCalls.push({ url, resolve, body: options!.body as ArrayBuffer }),
        );
      return Promise.resolve(Response.json({ generation: 1 }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function emit(length: number, endFrame: number) {
  act(() => {
    node.port.onmessage({
      data: { samples: new Float32Array(length).fill(0.08).buffer, endFrame },
    });
  });
}
function answer(index: number, overrides: object = {}) {
  const query = new URL("http://localhost" + audioCalls[index].url)
    .searchParams;
  audioCalls[index].resolve(
    Response.json({
      lineId: "line-2",
      generation: Number(query.get("generation")),
      sequence: Number(query.get("sequence")),
      status: "following",
      processingMs: 20,
      audioSeconds: 3.2,
      transcript: "тихий свет",
      ...overrides,
    }),
  );
}

describe("voice following transport", () => {
  it("streams new samples only and supplies the captured word time, ignoring old manual epochs", async () => {
    const song = createSong(),
      onLine = vi.fn(),
      onAnchor = vi.fn();
    const hook = renderHook(() =>
      useVoiceFollow(song, onLine, vi.fn(), { position: () => 12, onAnchor }),
    );
    await act(async () => {
      await hook.result.current.start(
        context as unknown as AudioContext,
        source as unknown as MediaStreamAudioSourceNode,
        "ru",
        "line-1",
      );
    });
    emit(8000, 8000);
    await waitFor(() => expect(audioCalls).toHaveLength(1));
    expect(audioCalls[0].body.byteLength).toBe(16000);
    expect(audioCalls[0].url).toContain("expectedPosition=12");
    emit(8000, 16000);
    await act(async () =>
      answer(0, { anchor: { songTime: 11.2, audioTime: 0.3 } }),
    );
    await waitFor(() => expect(audioCalls).toHaveLength(2));
    expect(onLine).not.toHaveBeenCalled();
    expect(onAnchor).toHaveBeenCalledOnce();
    expect(audioCalls[1].url).toContain("startSample=8000");
    await act(async () => {
      hook.result.current.manual("line-2");
    });
    await act(async () =>
      answer(1, { anchor: { songTime: 12, audioTime: 0.8 } }),
    );
    expect(onAnchor).toHaveBeenCalledOnce();
  });
  it("allows one request and sends only the freshest retained window after a slow response", async () => {
    const song = createSong();
    const onLine = vi.fn();
    const hook = renderHook(() => useVoiceFollow(song, onLine, vi.fn()));
    await act(async () => {
      await hook.result.current.start(
        context as unknown as AudioContext,
        source as unknown as MediaStreamAudioSourceNode,
        "ru",
        "line-1",
      );
    });
    emit(51200, 51200);
    await waitFor(() => expect(audioCalls).toHaveLength(1));
    expect(audioCalls[0].body.byteLength).toBe(102400);
    emit(160000, 211200);
    expect(audioCalls).toHaveLength(1);
    await act(async () => {
      answer(0);
    });
    await waitFor(() => expect(audioCalls).toHaveLength(2));
    const query = new URL("http://localhost" + audioCalls[1].url).searchParams;
    expect(Number(query.get("startSample"))).toBe(160000);
    expect(query.get("sampleRate")).toBe("16000");
    expect(query.get("channels")).toBe("1");
    await act(async () => {
      answer(1);
    });
    act(() => hook.result.current.stop());
    expect(node.port.close).toHaveBeenCalled();
    expect(source.disconnect).toHaveBeenCalled();
    expect(operations).toContain("DELETE /api/follow/sessions/session-1");
  });
  it("manual selection invalidates an old response and uses a new generation", async () => {
    const song = createSong();
    const onLine = vi.fn();
    const hook = renderHook(() => useVoiceFollow(song, onLine, vi.fn()));
    await act(async () => {
      await hook.result.current.start(
        context as unknown as AudioContext,
        source as unknown as MediaStreamAudioSourceNode,
        "ru",
        "line-1",
      );
    });
    emit(51200, 51200);
    await waitFor(() => expect(audioCalls).toHaveLength(1));
    await act(async () => {
      hook.result.current.manual("line-8");
    });
    emit(51200, 102400);
    await act(async () => {
      answer(0);
    });
    expect(onLine).not.toHaveBeenCalled();
    await waitFor(() => expect(audioCalls).toHaveLength(2));
    expect(audioCalls[1].url).toContain("generation=1");
    await act(async () => {
      answer(1, { lineId: "line-8" });
    });
    expect(onLine).toHaveBeenCalledWith("line-8");
  });
  it("stops the processing graph and reports backend failure without applying a hypothesis", async () => {
    const song = createSong();
    const onLine = vi.fn(),
      fatal = vi.fn();
    const hook = renderHook(() => useVoiceFollow(song, onLine, fatal));
    await act(async () => {
      await hook.result.current.start(
        context as unknown as AudioContext,
        source as unknown as MediaStreamAudioSourceNode,
        "ru",
        "line-1",
      );
    });
    emit(51200, 51200);
    await waitFor(() => expect(audioCalls).toHaveLength(1));
    await act(async () => {
      audioCalls[0].resolve(
        Response.json(
          { detail: "Модель повреждена. install-follow.ps1" },
          { status: 503 },
        ),
      );
    });
    expect(hook.result.current.active).toBe(false);
    expect(hook.result.current.error).toContain("install-follow.ps1");
    expect(fatal).toHaveBeenCalledOnce();
    expect(onLine).not.toHaveBeenCalled();
    expect(node.port.close).toHaveBeenCalled();
  });
});
