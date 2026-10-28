from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import follow_provider
from backend.audio import AnalysisError
from backend.main import create_app


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(follow_provider,'require_ready',lambda language: None)
    uid=lambda:str(uuid4())
    lines=[{'id':uid(),'text':text,'chords':[]} for text in ['тихий свет ложится на ладони','идем навстречу новому дню']]
    song={'id':uid(),'schemaVersion':1,'title':'Текст без MP3','artist':'','language':'ru','palette':[],
          'sections':[{'id':uid(),'name':'Куплет','lines':lines}],
          'performance':{'fontSize':24,'bpm':90,'beats':4},'audio':None,
          'source':'manual','updatedAt':'2026-10-25T12:00:00Z'}
    with TestClient(create_app(tmp_path, legacy_follow=True)) as client:
        assert client.post('/api/songs',json=song).status_code==201
        response=client.post('/api/follow/sessions',json={'songId':song['id'],'lineId':lines[0]['id'],'language':'ru'})
        assert response.status_code==201,response.text
        yield client,response.json()['id'],song


def window(client,session,pcm=None,**params):
    if pcm is None:
        pcm=(np.sin(np.arange(51200)*.05)*4000).astype('<i2').tobytes()
    query={'sequence':1,'generation':0,'startSample':0,'endSample':len(pcm)//2,
           'sampleRate':16000,'channels':1,'encoding':'pcm_s16le',**params}
    return client.post(f'/api/follow/sessions/{session}/audio',params=query,content=pcm,
                       headers={'Content-Type':'application/octet-stream'})


def test_streaming_api_partial_anchor_and_silence_epoch_reset(setup, monkeypatch):
    client, old, song = setup
    client.delete('/api/follow/sessions/'+old)
    line = song['sections'][0]['lines'][0]
    line.update(start=0., end=5., words=[{'text':w, 'start':float(i), 'end':i+.8} for i,w in enumerate(line['text'].split())])
    assert client.put('/api/songs/'+song['id'],json=song).status_code==200
    feeds=[]; closes=[]
    class Stream:
        def __init__(self,language):pass
        def close(self):closes.append(True)
        def feed(self,pcm,start,check):
            check();feeds.append(start)
            return [{'word':w,'start':.05+i*.1,'end':.15+i*.1} for i,w in enumerate('тихий свет ложится'.split())]
    monkeypatch.setattr(follow_provider,'StreamRecognizer',Stream)
    started=client.post('/api/follow/sessions',json={'songId':song['id'],'lineId':line['id'],'language':'ru','streaming':True})
    session=started.json()['id']
    response=window(client,session,expectedPosition=2)
    assert response.status_code==200,response.text
    assert response.json()['anchor']['songTime']==2.8
    # Silence is consumed to close the decoder utterance, but cannot correct clocks.
    response=window(client,session,pcm=b'\0'*16000,sequence=2,startSample=51200,endSample=59200)
    assert response.json()['anchor'] is None and response.json()['status']=='no_voice'
    assert feeds==[0,51200]
    assert client.post(f'/api/follow/sessions/{session}/position',json={'lineId':line['id'],'generation':1}).status_code==200
    assert window(client,session,sequence=3,generation=0).status_code==409
    assert client.delete('/api/follow/sessions/'+session).status_code==204
    assert closes


def test_audio_transport_rate_encoding_and_no_mp3_requirement(setup,monkeypatch):
    client,session,song=setup
    received=[]
    def recognize(pcm,lang,check):
        check();received.append((len(pcm),lang))
        return [{'word':word,'start':i*.3,'end':(i+1)*.3} for i,word in enumerate('идем навстречу новому дню'.split())]
    monkeypatch.setattr(follow_provider,'recognize',recognize)
    response=window(client,session)
    assert response.status_code==200,response.text
    result=response.json()
    assert result['status']=='following' and result['lineId']==song['sections'][0]['lines'][1]['id']
    assert result['processingMs']>=0 and received==[(102400,'ru')]
    assert window(client,session,sampleRate=48000).status_code==422
    assert window(client,session,channels=2).status_code==422
    assert window(client,session,encoding='float32').status_code==422
    assert window(client,session,pcm=b'x').status_code==422
    assert window(client,session,pcm=b'\0'*128002).status_code==413
    assert window(client,session,endSample=999).status_code==422


def test_silence_never_calls_recognizer_or_moves(setup,monkeypatch):
    client,session,song=setup
    monkeypatch.setattr(follow_provider,'recognize',lambda *args:pytest.fail('Silence must not be decoded'))
    for sequence in range(1,4):
        response=window(client,session,b'\0'*102400,sequence=sequence,startSample=sequence*60000,endSample=sequence*60000+51200)
        assert response.json()['status']=='no_voice'
        assert response.json()['lineId']==song['sections'][0]['lines'][0]['id']


def test_error_is_actionable_and_busy_slot_is_released(setup,monkeypatch):
    client,session,_=setup
    def broken(*args):raise AnalysisError('Проверьте локальную модель: install-follow.ps1')
    monkeypatch.setattr(follow_provider,'recognize',broken)
    response=window(client,session)
    assert response.status_code==503 and 'install-follow.ps1' in response.json()['detail']
    monkeypatch.setattr(follow_provider,'recognize',lambda *args:[])
    assert window(client,session,sequence=2).status_code==200
    assert client.delete('/api/follow/sessions/'+session).status_code==204
    assert window(client,session,sequence=3).status_code==404


def test_one_inflight_and_manual_reset_discards_native_result(setup,monkeypatch):
    client,session,song=setup
    entered,release=Event(),Event()
    def recognize(pcm,lang,check):
        entered.set();assert release.wait(5);check();return []
    monkeypatch.setattr(follow_provider,'recognize',recognize)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(window,client,session)
        try:
            assert entered.wait(3)
            assert window(client,session,sequence=2).status_code==409
            target=song['sections'][0]['lines'][1]['id']
            assert client.post(f'/api/follow/sessions/{session}/position',json={'lineId':target,'generation':1}).status_code==200
            release.set()
            assert pending.result(timeout=3).status_code==409
        finally:release.set()
    assert window(client,session,sequence=3).status_code==409
    assert window(client,session,b'\0'*102400,sequence=4,generation=1).json()['lineId']==target


def test_stop_cancels_inflight_and_batch_analysis_is_excluded(setup,monkeypatch):
    client,session,song=setup
    assert client.post(f"/api/songs/{song['id']}/analysis").status_code==409
    entered,release=Event(),Event()
    def recognize(pcm,lang,check):entered.set();assert release.wait(5);check();return []
    monkeypatch.setattr(follow_provider,'recognize',recognize)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(window,client,session)
        try:
            assert entered.wait(3)
            assert client.delete('/api/follow/sessions/'+session).status_code==204
            release.set();assert pending.result(timeout=3).status_code==409
        finally:release.set()


def test_missing_model_command_and_other_api_remains_available(tmp_path,monkeypatch):
    monkeypatch.setattr(follow_provider,'MODEL_ROOT',tmp_path/'absent')
    with TestClient(create_app(tmp_path/'data', legacy_follow=True)) as client:
        response=client.post('/api/follow/sessions',json={'songId':str(uuid4()),'lineId':str(uuid4()),'language':'uk'})
        assert response.status_code==503 and 'install-follow.ps1 -Language uk' in response.json()['detail']
        assert client.get('/api/songs').status_code==200
        assert client.get('/api/follow/status').json()['models']['uk']['installed'] is False
