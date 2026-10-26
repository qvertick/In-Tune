from backend.follow_matcher import LineMatcher, normalize


TEXTS = ['Тихий свет ложится на ладони', 'Мы идём навстречу новому дню',
         'Пусть аккорд негромко нас догонит', 'Я простой мотив с собой возьму']


def matcher(texts=TEXTS, line=0):
    return LineMatcher([{'id': str(i), 'text': text} for i, text in enumerate(texts)], str(line))


def words(text):
    return [{'word': word, 'start': i * .35, 'end': (i + 1) * .35} for i, word in enumerate(text.split())]


def feed(m, text, seq=1, start=0, generation=0):
    return m.accept(words(text), seq, generation, start, start + 51200)


def test_normalization_keeps_languages_and_apostrophes():
    assert normalize('  Ёжик,  СПІВАЄ! I’m here. ') == ['ежик', 'співає', 'im', 'here']


def test_progress_pause_and_spoken_words_are_not_changed():
    m = matcher()
    assert feed(m, TEXTS[0])['lineId'] == '0'
    assert feed(m, TEXTS[1], 2, 30000)['lineId'] == '1'
    assert feed(m, '', 3, 60000) == {'lineId':'1', 'status':'no_voice'}
    assert feed(m, '', 4, 90000)['lineId'] == '1'
    assert feed(m, TEXTS[2], 5, 120000)['lineId'] == '2'
    assert m.lines[0]['text'] == TEXTS[0]


def test_small_recognition_errors_and_skipped_word():
    m = matcher()
    assert feed(m, 'тихий свет ложиться ладони')['status'] == 'following'
    result = feed(m, 'идем навстречу новаму дню', 2, 40000)
    assert result['status'] == 'following' and result['lineId'] == '1'


def test_overlapping_repetition_does_not_advance_to_identical_chorus():
    m = matcher([TEXTS[0], TEXTS[1], TEXTS[0], TEXTS[2]])
    assert feed(m, TEXTS[0])['lineId'] == '0'
    assert feed(m, TEXTS[0], 2, 19200)['lineId'] == '0'
    assert feed(m, TEXTS[0], 3, 60000)['lineId'] == '0'
    m.reset('2', 1)
    assert feed(m, TEXTS[0], 4, 100000, 1)['lineId'] == '2'


def test_a_single_common_word_cannot_jump():
    m = matcher(line=2)
    for index, text in enumerate(['я', 'мы', 'дню', 'на', 'идем']):
        assert feed(m, text, index + 1, index * 60000)['lineId'] == '2'


def test_manual_reset_discards_old_epoch_and_out_of_order_reply():
    m = matcher()
    feed(m, TEXTS[0])
    m.reset('3', 1)
    assert feed(m, TEXTS[1], 2, 60000)['stale']
    assert feed(m, TEXTS[3], 3, 100000, 1)['lineId'] == '3'
    assert feed(m, TEXTS[1], 2, 60000, 1)['stale']


def test_identical_audio_time_cannot_be_consumed_again():
    m = matcher()
    feed(m, TEXTS[0])
    assert feed(m, TEXTS[1], 2, 0)['stale']


def test_cautious_far_recovery_needs_new_nonoverlapping_evidence():
    texts = [TEXTS[0]] + [f'промежуточный куплет номер {i}' for i in range(8)] + ['синий вечер тихо опускается над сонным городом']
    m = matcher(texts)
    heard = texts[-1]
    assert feed(m, heard)['lineId'] == '0'
    assert feed(m, heard, 2, 60000)['lineId'] == '0'
    assert feed(m, heard, 3, 120000)['lineId'] == '9'


def test_far_repeated_choruses_stay_ambiguous():
    chorus = 'синий вечер тихо опускается над сонным городом'
    m = matcher([TEXTS[0]] + ['другая совершенно непохожая строка'] * 8 + [chorus, 'иной куплет', chorus])
    for i in range(4):
        assert feed(m, chorus, i + 1, i * 60000)['lineId'] == '0'


def test_unknown_words_hold_position():
    m = matcher()
    assert feed(m, 'совершенно другие слова ничего знакомого')['status'] == 'uncertain'
    assert m.current == 0
