"""Recognize a supplied local PCM WAV through real HTTP handlers; no microphone."""
import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time
from uuid import uuid4
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend/.deps'))
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient
import httpx
from backend.main import create_app

TEXTS = ['Тихий свет ложится на ладони', 'Мы идём навстречу новому дню',
         'Пусть аккорд негромко нас догонит', 'Я простой мотив с собой возьму']


def benchmark(path, live_url=None):
    with wave.open(str(path), 'rb') as audio:
        assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (16000, 1, 2)
        pcm = audio.readframes(audio.getnframes())
    uid = lambda: str(uuid4())
    song = {'id': uid(), 'schemaVersion': 1, 'title':'Проверка голоса', 'artist':'', 'language':'ru',
            'palette':[], 'sections':[{'id':uid(), 'name':'Куплет',
                'lines':[{'id':uid(),'text':text,'chords':[]} for text in TEXTS]}],
            'performance':{'fontSize':24,'bpm':90,'beats':4},'audio':None,
            'updatedAt':'2026-10-25T12:00:00Z','source':'manual'}
    rows = song['sections'][0]['lines']
    measurements, seen = [], []
    with tempfile.TemporaryDirectory(prefix='follow-benchmark-') as directory, (httpx.Client(base_url=live_url,timeout=30) if live_url else TestClient(create_app(directory))) as client, ExitStack() as cleanup:
        assert client.post('/api/songs', json=song).status_code == 201
        cleanup.callback(client.delete,'/api/songs/'+song['id'])
        started = client.post('/api/follow/sessions',json={'songId':song['id'],'language':'ru','lineId':rows[0]['id']})
        assert started.status_code == 201, started.text
        session = started.json()['id']
        cleanup.callback(client.delete,'/api/follow/sessions/'+session)
        sequence = 0
        for start in range(0, len(pcm) // 2 - 51200 + 1, 19200):
            fragment = pcm[start*2:(start + 51200)*2]
            if len(fragment)<16000: break
            sequence += 1
            before = time.perf_counter()
            response = client.post(f'/api/follow/sessions/{session}/audio',
                params={'sequence':sequence,'generation':0,'startSample':start,'endSample':start+len(fragment)//2,
                        'sampleRate':16000,'channels':1,'encoding':'pcm_s16le'},
                content=fragment, headers={'Content-Type':'application/octet-stream'})
            assert response.status_code == 200, response.text
            result = response.json()
            elapsed = round((time.perf_counter()-before)*1000,1)
            row = next(i for i,line in enumerate(rows) if line['id']==result['lineId'])
            seen.append(row)
            measurements.append({'windowStartSeconds':start/16000,'windowSeconds':len(fragment)/32000,
                                 'processingMs':result['processingMs'],'handlerMs':elapsed,
                                 'line':row+1,'status':result['status'],'transcript':result['transcript']})
        # Silence must hold the last position, without invoking the recognizer.
        position = seen[-1]
        silent = client.post(f'/api/follow/sessions/{session}/audio',
            params={'sequence':sequence+1,'generation':0,'startSample':len(pcm)//2,'endSample':len(pcm)//2+51200},
            content=b'\0'*102400, headers={'Content-Type':'application/octet-stream'}).json()
        assert silent['status']=='no_voice' and silent['lineId']==rows[position]['id']
        assert client.delete('/api/follow/sessions/'+session).status_code==204
    report={'fixture':str(path),'kind':'local synthesized speech, not live singing',
            'transport':live_url or 'in-process HTTP handlers',
            'captureWindowSeconds':3.2,'strideSeconds':1.2,
            'firstProcessingMs':measurements[0]['processingMs'],
            'warmMedianProcessingMs':statistics.median(m['processingMs'] for m in measurements[1:]),
            'maxProcessingMs':max(m['processingMs'] for m in measurements),
            'visitedLines':sorted(set(x+1 for x in seen)),'windows':measurements}
    return report


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wav',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--live-url',help='Optional running local backend URL; only temporary test songs are deleted.')
    args=parser.parse_args()
    report=benchmark(args.wav,args.live_url)
    encoded=json.dumps(report,ensure_ascii=False,indent=2)
    if args.output: args.output.write_text(encoded,encoding='utf8')
    print(encoded)
