// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Performance from "./Performance";
import { createSong } from "./model";

let capture: any;
let song: ReturnType<typeof createSong>;
const track = {
  stop: vi.fn(),
  getSettings: () => ({ sampleRate: 16000 }),
  onended: null,
};
const close = vi.fn().mockResolvedValue(undefined);
const getUserMedia = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  song = createSong(true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: async () => [] },
  });
  getUserMedia.mockResolvedValue({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 16000;
      state = "running";
      destination = {};
      audioWorklet = { addModule: async () => {} };
      resume = async () => {};
      close = close;
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 1024,
          connect: vi.fn(),
          disconnect: vi.fn(),
          getFloatTimeDomainData: vi.fn(),
        };
      }
      createGain() {
        return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      }
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        capture = this;
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/follow/status")
        return Response.json({
          version: "0.3.45",
          models: {
            ru: { installed: true },
            uk: { installed: false },
            en: { installed: false },
          },
        });
      if (url === "/api/follow/sessions")
        return Response.json({ id: "session" });
      if (url.includes("/audio?")) {
        const query = new URL("http://localhost" + url).searchParams;
        return Response.json({
          status: "following",
          lineId: song.sections[0].lines[1].id,
          generation: Number(query.get("generation")),
          sequence: Number(query.get("sequence")),
          processingMs: 100,
          audioSeconds: 3.2,
          transcript: "мы идем навстречу",
        });
      }
      return Response.json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Performance voice flow", () => {
  it("requests one microphone, highlights a recognized line without MP3 and releases tracks on stop", async () => {
    const user = userEvent.setup();
    render(<Performance song={song} onBack={vi.fn()} onSettings={vi.fn()} />);
    expect(song.audio).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Следовать за голосом" }),
    );
    await screen.findByRole("button", { name: "Остановить следование" });
    expect(getUserMedia).toHaveBeenCalledOnce();
    act(() =>
      capture.port.onmessage({
        data: {
          samples: new Float32Array(51200).fill(0.08).buffer,
          endFrame: 51200,
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /^Строка 2:/ })
          .getAttribute("aria-current"),
      ).toBe("step"),
    );
    await user.click(screen.getByRole("button", { name: /^Строка 1:/ }));
    expect(
      screen
        .getByRole("button", { name: /^Строка 1:/ })
        .getAttribute("aria-current"),
    ).toBe("step");
    await user.click(
      screen.getByRole("button", { name: "Остановить следование" }),
    );
    expect(track.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalled();
    expect(capture.port.close).toHaveBeenCalled();
  });
  it("explains microphone permission refusal and never starts recognition", async () => {
    getUserMedia.mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const user = userEvent.setup();
    render(<Performance song={song} onBack={vi.fn()} onSettings={vi.fn()} />);
    await user.click(
      screen.getByRole("button", { name: "Следовать за голосом" }),
    );
    await screen.findByText(/Доступ к микрофону запрещён/);
    const urls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0],
    );
    expect(urls).not.toContain("/api/follow/sessions");
    expect(close).toHaveBeenCalled();
  });
});
