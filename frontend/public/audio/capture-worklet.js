// Loaded as a local AudioWorklet module, without remote dependencies.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(Math.ceil(sampleRate / 10));
    this.offset = 0;
    this.frames = 0;
    this.pending = false;
    this.port.onmessage = () => {
      this.pending = false;
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      this.frames++;
      let mono = 0;
      for (const channel of channels) mono += channel[i] || 0;
      this.chunk[this.offset++] = mono / channels.length;
      if (this.offset === this.chunk.length) {
        if (!this.pending) {
          this.port.postMessage(
            {
              samples: this.chunk.buffer,
              endFrame: this.frames,
              contextFrame:
                typeof currentFrame === "number"
                  ? currentFrame + i + 1
                  : undefined,
            },
            [this.chunk.buffer],
          );
          this.pending = true;
          this.chunk = new Float32Array(Math.ceil(sampleRate / 10));
        }
        this.offset = 0;
      }
    }
    // Outputs remain zero: microphone audio is never sent to the speakers.
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
