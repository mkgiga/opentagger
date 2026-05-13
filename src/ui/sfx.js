// Audio sound effects.
//
// On module init we resolve the <audio id="sfx*"> elements baked into
// index.html. Module scripts are deferred, so the body is parsed by
// the time this runs.

export const sfx = {
    sfxWelcome: null,
    sfxGood1: null,
    sfxGood2: null,
    sfxGood3: null,
    sfxBad: null,
    sfxGoodnight: null,
    sfxPop: null,
};

export const fadeOutAudioContext = new AudioContext({
    sampleRate: 44100,
    latencyHint: "interactive",
});

for (const key in sfx) {
    const audio = document.getElementById(key);
    audio.volume = 0.1;
    sfx[key] = audio;
}
