"""Conservative word sequence alignment; display text is never modified."""
from collections import defaultdict
from difflib import SequenceMatcher
import re
import unicodedata

STOP = set('я ты он она мы вы они и а но в на с к у по не да это как что то за из для мне тебя меня мой твой є й та і не до ми ви я ти він вона це the a an and or i you he she we they to of in on at is it my your me be for so'.split())


def normalize(text):
    text = unicodedata.normalize('NFKC', text).casefold().replace('ё', 'е').replace('’', "'")
    return [word.replace("'", '') for word in re.findall(r"[^\W_]+(?:'[^\W_]+)*", text, re.UNICODE)]


def similarity(a, b):
    if a == b:
        return 1.0
    if min(len(a), len(b)) < 4:
        return 0.0
    ratio = SequenceMatcher(None, a, b, autojunk=False).ratio()
    return 0.8 if ratio >= 0.76 else 0.0


def align(heard, reference, base=0):
    """Small Smith-Waterman table, with penalized skipped/misrecognized words."""
    n, m = len(heard), len(reference)
    scores = [[0.0] * (m + 1) for _ in range(n + 1)]
    steps = [[0] * (m + 1) for _ in range(n + 1)]
    endpoints = []
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            match = similarity(heard[i - 1], reference[j - 1])
            options = (0, scores[i - 1][j - 1] + (match if match else -0.85),
                       scores[i - 1][j] - 0.65, scores[i][j - 1] - 0.65)
            step = max(range(4), key=options.__getitem__)
            scores[i][j], steps[i][j] = options[step], step
            if match and scores[i][j] >= 1.6:
                endpoints.append((scores[i][j], i, j))
    candidates = []
    for score, i, j in sorted(endpoints, reverse=True)[:24]:
        matches = []
        while i and j and scores[i][j] > 0:
            step = steps[i][j]
            if step == 1:
                if similarity(heard[i - 1], reference[j - 1]):
                    matches.append((i - 1, base + j - 1))
                i, j = i - 1, j - 1
            elif step == 2:
                i -= 1
            elif step == 3:
                j -= 1
            else:
                break
        matches.reverse()
        content = {heard[a] for a, _ in matches if heard[a] not in STOP and len(heard[a]) >= 3}
        if len(matches) < 2 or len(content) < 2 or len(matches) / max(1, n) < 0.5:
            continue
        if matches[-1][1] - matches[0][1] > len(heard) + 3:
            continue
        candidates.append({'score': score, 'matches': matches, 'end': matches[-1][1],
                           'start': matches[0][1], 'content': len(content)})
    return candidates


class LineMatcher:
    def __init__(self, lines, current_line):
        self.lines = lines
        self.tokens, self.line_of, self.starts = [], [], []
        self.index = defaultdict(list)
        for number, line in enumerate(lines):
            self.starts.append(len(self.tokens))
            for token in normalize(line['text']):
                self.index[token].append(len(self.tokens))
                self.tokens.append(token)
                self.line_of.append(number)
        if not self.tokens or len(self.tokens) > 40000:
            raise ValueError('Для следования нужен текст песни, не более 40 000 слов.')
        self.generation = -1
        self.reset(current_line, 0)

    def reset(self, line_id, generation):
        number = next((i for i, line in enumerate(self.lines) if line['id'] == line_id), None)
        if number is None:
            raise ValueError('Выбранная строка отсутствует в песне.')
        self.current = number
        self.cursor = self.starts[number] - 1
        self.generation = generation
        self.sequence = -1
        self.audio_end = -1
        self.speech_end = -1
        self.fingerprint = None
        self.last_window_end = -1
        self.misses = 0
        self.recovery = None

    def response(self, status, **extra):
        return {'lineId': self.lines[self.current]['id'], 'status': status, **extra}

    def _local(self, heard):
        first = self.starts[max(0, self.current - 1)]
        last_line = min(len(self.lines), self.current + 5)
        last = self.starts[last_line] if last_line < len(self.lines) else len(self.tokens)
        first = max(first, self.cursor - 45)
        return align(heard, self.tokens[first:min(last, first + 160)], first)

    def _recover(self, heard):
        # Search only bounded candidate regions anchored by uncommon exact words.
        regions = set()
        for token in heard:
            if token in STOP or len(token) < 4 or len(self.index[token]) > 100:
                continue
            for location in self.index[token]:
                regions.add(max(0, location - len(heard)))
        candidates = []
        for first in sorted(regions)[:64]:
            candidates.extend(align(heard, self.tokens[first:first + 2 * len(heard) + 6], first))
        unique = {}
        for candidate in candidates:
            line = self.line_of[candidate['end']]
            if candidate['content'] >= 3 and len(candidate['matches']) >= 5 and candidate['score'] >= 4:
                if line not in unique or candidate['score'] > unique[line]['score']:
                    unique[line] = candidate
        ranked = sorted(unique.values(), key=lambda c: c['score'], reverse=True)
        if len(ranked) > 1 and ranked[0]['score'] - ranked[1]['score'] < 0.8:
            return None  # Repeated choruses remain ambiguous without context.
        return ranked[0] if ranked else None

    def accept(self, words, sequence, generation, start_sample, end_sample):
        if generation != self.generation or sequence <= self.sequence or end_sample <= self.audio_end:
            return self.response('listening', stale=True)
        self.sequence, self.audio_end = sequence, end_sample
        heard, times = [], []
        for word in words[:60]:
            tokens = normalize(word['word'])
            heard.extend(tokens)
            times.extend([start_sample + int(word['end'] * 16000)] * len(tokens))
        if not heard:
            self.recovery = None
            return self.response('no_voice')
        fingerprint = tuple(heard)
        if fingerprint == self.fingerprint and start_sample < self.last_window_end:
            return self.response('following', duplicate=True)
        self.fingerprint, self.last_window_end = fingerprint, end_sample
        candidates = self._local(heard)
        if candidates:
            best_score = max(c['score'] for c in candidates)
            near = [c for c in candidates if c['score'] >= best_score - 0.2]
            best = min(near, key=lambda c: abs(c['end'] - self.cursor))
        else:
            best = None
        if best is None:
            self.misses += 1
            if self.misses >= 2 and len(heard) >= 5:
                distant = self._recover(heard)
                if distant:
                    line = self.line_of[distant['end']]
                    if self.recovery and abs(self.recovery[0] - line) <= 1 and start_sample >= self.recovery[1]:
                        best = distant
                    else:
                        self.recovery = (line, end_sample)
            if best is None:
                return self.response('uncertain')
        matched_time = max(times[i] for i, _ in best['matches'])
        if matched_time <= self.speech_end + 1600:
            return self.response('following', duplicate=True)
        line = self.line_of[best['end']]
        # An old part of an overlapping window cannot move the cursor backwards.
        if best['end'] <= self.cursor and start_sample < self.speech_end:
            return self.response('following', duplicate=True)
        self.current, self.cursor = line, best['end']
        self.speech_end = matched_time
        self.misses, self.recovery = 0, None
        return self.response('following')
