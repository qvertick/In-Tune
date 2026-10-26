"""Replay a real WAV at wall-clock speed through streaming HTTP; never opens a microphone."""
import argparse
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time
from uuid import uuid4
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend/.deps'), str(ROOT)]
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.follow_provider import StreamRecognizer
from backend.timing import attach_words


def run(path):
    with wave.open(str(path), 'rb') as f:
        assert (f.getframerate(), f.getnchannels(), f.getsampwidth()) == (16000, 1, 2)
        pcm = f.readframes(f.getnframes())
    text = ['Тихий свет ложится на ладони', 'Мы идём навстречу новому дню',
            'Пусть аккорд негромко нас догонит', 'Я простой мотив с собой возьму']
    uid = lambda: str(uuid4())
    song = {'schemaVersion':1,'id':uid(),'title':'Проверка временной карты','artist':'Синтез речи, не пение',
            'language':'ru','palette':[],'sections':[{'id':uid(),'name':'Проверка','lines':[
                {'id':uid(),'text':t,'chords':[]} for t in text]}],
            'audio':None,'source':'manual','updatedAt':'2026-10-26T12:00:00Z',
            'performance':{'fontSize':24,'bpm':90,'beats':4}}
    decoder = StreamRecognizer('ru', retain_all=True)
    for start in range(0, len(pcm)//2, 8000):
        decoder.feed(pcm[start*2:(start+8000)*2], start, lambda:None)
    words = decoder.finish(lambda:None); decoder.close()
    song = attach_words(song, words)
    timed = [l for l in song['sections'][0]['lines'] if l.get('words')]
    report = {'fixture':str(path),'kind':'synthesized Russian speech, NOT singing',
              'preparationTranscript':' '.join(w['word'] for w in words),
              'wordTimedLines':len(timed),'lineOnlyLines':sum('start' in l and not l.get('words') for l in song['sections'][0]['lines']), 'unmappedLines':sum(l.get('timingReview',False) for l in song['sections'][0]['lines']),'chunks':[]}
    assert timed, report
    with tempfile.TemporaryDirectory() as directory, TestClient(create_app(directory)) as client:
        created = client.post('/api/songs',json=song); assert created.status_code==201,created.text
        session=client.post('/api/follow/sessions',json={'songId':song['id'],'lineId':timed[0]['id'],'language':'ru','streaming':True})
        assert session.status_code==201,session.text
        identifier=session.json()['id']
        origin=time.perf_counter(); previous=0; sequence=0
        # Exactly one request in flight. When behind, send only the newest <=1 s.
        while previous < len(pcm)//2:
            next_end=min(len(pcm)//2,previous+8000)
            deadline=origin+next_end/16000
            while time.perf_counter()<deadline:
                time.sleep(min(.1,deadline-time.perf_counter()))
            end=min(len(pcm)//2,max(next_end,int((time.perf_counter()-origin)*16000)))
            start=max(previous,end-16000)
            if end-start<8000: break
            sequence+=1
            response=client.post(f'/api/follow/sessions/{identifier}/audio',params={
                'sequence':sequence,'generation':0,'startSample':start,'endSample':end,'expectedPosition':end/16000},
                content=pcm[start*2:end*2],headers={'Content-Type':'application/octet-stream'})
            assert response.status_code==200,response.text
            result=response.json(); anchor=result.get('anchor')
            report['chunks'].append({'end':end/16000,'processingMs':result['processingMs'],
                'audioEndAgeMs':round((time.perf_counter()-origin-end/16000)*1000,1),
                'confirmedAudioAgeMs': round((time.perf_counter()-origin-anchor['audioTime'])*1000,1) if anchor else None,
                'anchor':anchor,'transcript':result['transcript'],'droppedSamples':start-previous})
            previous=end
        client.delete('/api/follow/sessions/'+identifier)
    anchors=[c for c in report['chunks'] if c['anchor']]
    assert anchors, report
    report.update(anchorCount=len(anchors),medianProcessingMs=statistics.median(c['processingMs'] for c in report['chunks']),
                  maxAudioEndAgeMs=max(c['audioEndAgeMs'] for c in report['chunks']),
                  droppedSamples=sum(c['droppedSamples'] for c in report['chunks']))
    return report, song


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf8')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wav',type=Path);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report,song=run(args.wav)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    args.output.with_suffix('.song.json').write_text(json.dumps(song,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k!='chunks'},ensure_ascii=False,indent=2))
