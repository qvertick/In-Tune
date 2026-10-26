import json
import sys
from types import SimpleNamespace

import pytest

from backend import follow_provider, providers
from backend.audio import Cancelled


def test_reuses_one_model_and_unloads_whisper_and_previous_language(monkeypatch):
    loaded,recognizers=[],[]
    monkeypatch.setattr(follow_provider,'_model',None)
    monkeypatch.setattr(follow_provider,'_language',None)
    monkeypatch.setattr(follow_provider,'require_ready',lambda language:None)
    monkeypatch.setattr(providers,'_model',object())
    class Model:
        def __init__(self,path):loaded.append(path)
    class Recognizer:
        def __init__(self,model,rate):assert rate==16000;recognizers.append(rate)
        def SetWords(self,enabled):assert enabled is True
        def AcceptWaveform(self,pcm):return False
        def FinalResult(self):return json.dumps({'result':[{'word':'hello','start':0,'end':.2,'conf':.9}]})
    monkeypatch.setitem(sys.modules,'vosk',SimpleNamespace(Model=Model,KaldiRecognizer=Recognizer,SetLogLevel=lambda level:None))
    for _ in range(2):
        assert follow_provider.recognize(b'\0'*10000,'ru',lambda:None)[0]['word']=='hello'
    assert len(loaded)==1 and len(recognizers)==2 and providers._model is None
    follow_provider.recognize(b'\0'*10000,'en',lambda:None)
    assert len(loaded)==2 and follow_provider._language=='en'


def test_cancel_before_loading_releases_shared_lock():
    def check():raise Cancelled()
    with pytest.raises(Cancelled):follow_provider.recognize(b'\0'*32000,'ru',check)
    assert providers._lock.acquire(blocking=False)
    providers._lock.release()
