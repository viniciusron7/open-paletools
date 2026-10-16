/**
 * Web Audio "ding" played by the snipe plugin; `dingSoundPlayer.init()` is called once by
 * src/bootstrap/boot.js.
 *
 * Invariants:
 * - `init` creates the playback `AudioContext` and renders a 1 s, 1 kHz sine with an
 *   exponential fade (gain 0.1) in an `OfflineAudioContext`; `ding()` is a silent no-op until
 *   that buffer exists and swallows playback errors.
 *
 * Known issues (kept as-is):
 * - `init` creates a second `AudioContext` only to read its sample rate and never closes it.
 */
export const dingSoundPlayer = {
  init: async () => {
    dingAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    await (async function () {
      const referenceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      const offlineAudioContext = new OfflineAudioContext(
        1,
        1 * referenceAudioContext.sampleRate,
        referenceAudioContext.sampleRate,
      );
      const oscillator = offlineAudioContext.createOscillator();
      const gain = offlineAudioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(1000, offlineAudioContext.currentTime);
      gain.gain.setValueAtTime(0.1, offlineAudioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.00001, offlineAudioContext.currentTime + 1);
      oscillator.connect(gain);
      gain.connect(offlineAudioContext.destination);
      oscillator.start();
      oscillator.stop(offlineAudioContext.currentTime + 1);
      dingAudioBuffer = await offlineAudioContext.startRendering();
    })();
  },
  ding: () => {
    if (dingAudioBuffer) {
      try {
        const bufferSource = dingAudioContext.createBufferSource();
        bufferSource.buffer = dingAudioBuffer;
        bufferSource.connect(dingAudioContext.destination);
        bufferSource.start();
      } catch {}
    }
  },
};

let dingAudioContext;

let dingAudioBuffer;
