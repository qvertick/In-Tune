from copy import deepcopy
from uuid import uuid4
from backend.timing import attach_words, TimedMatcher
from backend.follow_provider import StreamRecognizer
import json
import sys
from types import SimpleNamespace
from backend import follow_provider


def lines():
    texts = ['тихий свет ложится', 'новый день приходит', 'тихий свет ложится']
    return [{'id':str(uuid4()), 'text':text,'chords':[], 'start':i*10.,'end':i*10.+3,
             'words':[{'text':word,'start':i*10.+j,'end':i*10.+j+.8} for j,word in enumerate(text.split())]} for i,text in enumerate(texts)]


def heard(text, at=0):
    return [{'word':w,'start':at+i,'end':at+i+.8} for i,w in enumerate(text.split())]


def test_repeated_chorus_near_expected_time_and_duplicate_partial():
    m=TimedMatcher(lines())
    a=m.match(heard('тихий свет ложится', 100), 21)
    assert a == {'songTime':22.8,'audioTime':102.8}
    assert m.match(heard('тихий свет ложится', 100), 22) is None
    assert m.match(heard('свет'), 21) is None
    assert TimedMatcher(lines()).match(heard('тихий свет ложится'), 12.7) is None


def test_prepare_preserves_manual_data_and_only_times_matching_words():
    rows=lines(); rows[1].pop('start');rows[1].pop('end');rows[1].pop('words')
    song={'id':str(uuid4()),'sections':[{'lines':rows}]}; before=deepcopy(song)
    draft=attach_words(song, heard('новый день приходит',10))
    assert song==before and draft['sections'][0]['lines'][0]==rows[0]
    assert draft['sections'][0]['lines'][1]['words'][1]['start']==11
    rows[1]['text']='совсем другой текст'
    draft=attach_words(song, heard('новый день приходит',10))
    assert draft['sections'][0]['lines'][1]['timingReview'] is True


def test_stream_keeps_decoder_and_partial_timestamps_resets_on_capture_gap(monkeypatch):
    created=[]
    class Recognizer:
        def __init__(self,*args): created.append(self)
        def SetWords(self,v): pass
        def SetPartialWords(self,v): pass
        def AcceptWaveform(self,pcm):return False
        def PartialResult(self):return json.dumps({'partial_result':[{'word':'свет','start':.1,'end':.2,'conf':.9}]})
    monkeypatch.setitem(sys.modules,'vosk',SimpleNamespace(Model=object,KaldiRecognizer=Recognizer,SetLogLevel=lambda _:None))
    monkeypatch.setattr(follow_provider,'_model',object()); monkeypatch.setattr(follow_provider,'_language','ru')
    monkeypatch.setattr(follow_provider,'require_ready',lambda _:None)
    r=StreamRecognizer('ru')
    assert r.feed(b'\0'*16000,16000,lambda:None)[0]['end']==1.2
    r.feed(b'\0'*16000,24000,lambda:None); assert len(created)==1
    assert r.feed(b'\0'*16000,48000,lambda:None)[0]['end']==3.2
    assert len(created)==2
    r.close();assert r.recognizer is None
