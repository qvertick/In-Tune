"""Conservative alignment of existing lyrics to actual ASR word intervals."""
from copy import deepcopy
from difflib import SequenceMatcher
import wave
from uuid import uuid4

from .audio import AnalysisError, decode_audio
from .follow_matcher import normalize, align, similarity
from . import follow_provider
from .schema import Song


def attach_words(song, words):
    draft = deepcopy(song)
    lines = [l for s in draft['sections'] for l in s['lines']]
    reference, locations = [], []
    for i, line in enumerate(lines):
        for j, token in enumerate(line['text'].split()):
            normalized = normalize(token)
            if len(normalized) != 1:
                continue
            reference.append(normalized[0]); locations.append((i, j))
    heard = [normalize(w['word']) for w in words]
    heard = [w[0] if len(w) == 1 else '' for w in heard]
    assigned = {}
    # Global order prevents identical choruses all being attached to the first occurrence.
    comparison = SequenceMatcher(None, reference, heard, autojunk=False)
    for block in comparison.get_matching_blocks():
        if block.size < 2:
            continue
        for offset in range(block.size):
            assigned[locations[block.a + offset]] = words[block.b + offset]
    # A one-word pronunciation mismatch bounded by matching context can use its
    # measured interval. Never synthesize an interval for a missing word.
    for tag, a, b, c, d in comparison.get_opcodes():
        if tag == 'replace' and b-a == d-c == 1 and a > 0 and b < len(reference):
            if locations[a-1] in assigned and locations[b] in assigned and similarity(reference[a], heard[c]):
                assigned[locations[a]] = words[c]
    count = 0
    for i, line in enumerate(lines):
        # Existing/manual maps are preserved; preparing again never erases corrections.
        if line.get('start') is not None and not line.get('timingReview'):
            continue
        tokens = line['text'].split()
        mapped = [assigned.get((i, j)) for j in range(len(tokens))]
        if not tokens:
            continue
        if not all(mapped):
            # Both boundaries must actually be heard; interiors may be missing.
            if mapped[0] and mapped[-1] and sum(w is not None for w in mapped) >= max(2, len(tokens)*.7):
                line.update(start=mapped[0]['start'], end=mapped[-1]['end'], timingReview=False)
                line.pop('words', None)
                count += 1
                continue
            line['timingReview'] = True
            continue
        if any(w['end'] <= w['start'] for w in mapped):
            line['timingReview'] = True
            continue
        line.update(start=mapped[0]['start'], end=mapped[-1]['end'], timingReview=False,
                    words=[{'text': token, 'start': w['start'], 'end': w['end']} for token, w in zip(tokens, mapped)])
        count += 1
    if not count and not any(l.get('start') is not None for l in lines):
        raise AnalysisError('Не удалось надёжно совместить текст с записью. Расставьте начало и конец строк вручную в «Проверке разметки».')
    draft['id'] = str(uuid4())
    return draft


def prepare(song, source, check):
    follow_provider.require_ready(song['language'])
    check('decoding')
    words = []
    stream = follow_provider.StreamRecognizer(song['language'], retain_all=True)
    try:
        with decode_audio(source, check) as wav:
            check('transcribing')
            with wave.open(str(wav), 'rb') as audio:
                sample = 0
                while pcm := audio.readframes(8000):
                    check()
                    stream.feed(pcm, sample, check)
                    sample += len(pcm) // 2
                words = stream.finish(check)
    finally:
        stream.close()
    check('saving')
    return Song.model_validate(attach_words(song, words))


class TimedMatcher:
    def __init__(self, lines):
        self.tokens, self.times, self.uncertainties = [], [], []
        for line in lines:
            if line.get('timingReview'):
                continue
            words = line.get('words') or []
            if (not words or normalize(' '.join(w['text'] for w in words)) != normalize(line['text'])
                    or any(w['end'] <= w['start'] or w['start'] < line.get('start', 0)
                           or w['end'] > line.get('end', float('inf'))
                           or (i and w['start'] < words[i-1]['end']) for i,w in enumerate(words))):
                start, end = line.get('start'), line.get('end')
                if start is not None and end is not None and end > start:
                    for token in normalize(line['text']):
                        self.tokens.append(token); self.times.append((start+end)/2)
                        self.uncertainties.append((end-start)/2)
                continue
            for word in words:
                for token in normalize(word['text']):
                    self.tokens.append(token); self.times.append(word['end'])
                    self.uncertainties.append(0)
        self.last_audio = -1
        self.recovery = None

    def match(self, words, expected):
        words = words[-24:]
        heard = [normalize(w['word']) for w in words]
        if not heard or any(len(w) != 1 for w in heard):
            return None
        heard = [w[0] for w in heard]
        indices = [i for i, t in enumerate(self.times) if abs(t - expected) <= 12]
        candidates = align(heard, self.tokens[min(indices):max(indices)+1], min(indices)) if indices else []
        if not candidates:
            # Recovery across a long skip needs a long unique phrase, then independent evidence.
            candidates = align(heard, self.tokens) if len(heard) >= 5 and len(self.tokens) <= 3000 else []
            candidates = [c for c in candidates if len(c['matches']) >= 5 and c['content'] >= 3]
        if not candidates:
            return None
        candidates.sort(key=lambda c: (-c['score'], abs(self.times[c['end']] - expected)))
        best = candidates[0]
        near = [c for c in candidates if c['score'] >= best['score'] - .2]
        best = min(near, key=lambda c: abs(self.times[c['end']] - expected))
        other = [c for c in near if abs(self.times[c['end']] - self.times[best['end']]) > 3]
        if other and abs(abs(self.times[other[0]['end']] - expected) - abs(self.times[best['end']] - expected)) < 2:
            return None
        heard_index, reference_index = best['matches'][-1]
        audio_time, song_time = words[heard_index]['end'], self.times[reference_index]
        if audio_time <= self.last_audio + .1:
            return None
        if abs(song_time - expected) > 12:
            previous = self.recovery
            self.recovery = (audio_time, song_time)
            if previous is None or audio_time - previous[0] < .5 or abs((song_time-previous[1])-(audio_time-previous[0])) > 2:
                return None
        self.last_audio = audio_time
        result = {'songTime': song_time, 'audioTime': audio_time}
        if self.uncertainties[reference_index]:
            result['uncertainty'] = self.uncertainties[reference_index]
        return result
