"""Offline provider/wire tests: no app lifespan, account, network or microphone."""
import gzip
import json
import struct
from uuid import uuid4
import pytest
from app.services.voice.protocol import AudioFrame, VoiceError, decode_audio_frame, encode_audio_frame
from app.services.voice.volcengine import (ASRStream, TTSStream, VolcengineConfig, VolcengineProvider,
    MAX_PROVIDER_PAYLOAD, decode_asr_frame, decode_tts_frame, encode_asr_frame, encode_tts_event)


def asr(text='hello', final=False, compressed=True):
    data = json.dumps({'result': {'text': text}}).encode()
    if compressed: data = gzip.compress(data)
    return bytes((0x11, 0x93 if final else 0x91, 0x11 if compressed else 0x10, 0)) + struct.pack('!iI', -2 if final else 2, len(data)) + data


def tts(event, identity, payload=b'{}', audio=False):
    sid = identity.encode()
    return bytes((0x11, 0xB4 if audio else 0x94, 0 if audio else 0x10, 0)) + struct.pack('!II', event, len(sid)) + sid + struct.pack('!I', len(payload)) + payload


class Socket:
    def __init__(self, frames=(), fail_send=False):
        self.frames=list(frames); self.sent=[]; self.closed=False; self.fail_send=fail_send
    async def send(self, value):
        if self.fail_send: raise OSError('secret diagnostic must not escape')
        self.sent.append(value)
    async def recv(self):
        if not self.frames: raise EOFError('end')
        return self.frames.pop(0)
    async def close(self): self.closed=True


@pytest.mark.parametrize('kind', [1, 2])
def test_envelope_roundtrip(kind):
    frame=AudioFrame(kind,str(uuid4()),42,b'\0\1'*320)
    wire=encode_audio_frame(frame)
    assert len(wire)==668 and decode_audio_frame(wire,kind)==frame


@pytest.mark.parametrize('wire', [b'',b'ARV1',b'x'*27,b'x'*70000])
def test_envelope_size(wire):
    with pytest.raises(VoiceError): decode_audio_frame(wire)


@pytest.mark.parametrize('offset,value', [(0,0),(4,2),(5,1),(6,1)])
def test_envelope_header(offset,value):
    wire=bytearray(encode_audio_frame(AudioFrame(1,str(uuid4()),0,b'\0\0')));wire[offset]=value
    with pytest.raises(VoiceError): decode_audio_frame(bytes(wire))


@pytest.mark.parametrize('payload,sequence', [(b'',0),(b'x',0),(b'\0\0',-1),(b'\0\0',2**32)])
def test_envelope_invalid_values(payload,sequence):
    with pytest.raises(VoiceError): encode_audio_frame(AudioFrame(1,str(uuid4()),sequence,payload))


def test_asr_request_negative_final():
    wire=encode_asr_frame(b'\0\1'*320,3,audio=True,final=True)
    assert wire[:4]==b'\x11\x23\x01\0' and struct.unpack_from('!i',wire,4)[0]==-3
    assert gzip.decompress(wire[12:])==b'\0\1'*320
    assert encode_asr_frame(b'{}',1,audio=False)[:4]==b'\x11\x11\x11\0'


@pytest.mark.parametrize('compressed',[True,False])
def test_asr_decode(compressed):
    frame=decode_asr_frame(asr('你好',True,compressed))
    assert frame.final and frame.sequence==-2 and json.loads(frame.payload)['result']['text']=='你好'


@pytest.mark.parametrize('transform',[lambda x:x[:-1],lambda x:x+b'extra',lambda x:b'\x21'+x[1:]])
def test_bad_provider_frame(transform):
    with pytest.raises(ValueError): decode_asr_frame(transform(asr()))
    with pytest.raises(ValueError): decode_tts_frame(transform(tts(150,'s')))


def test_gzip_bomb_bounded():
    payload=gzip.compress(b'x'*(MAX_PROVIDER_PAYLOAD+1))
    with pytest.raises(ValueError): decode_asr_frame(b'\x11\x90\x11\0'+struct.pack('!I',len(payload))+payload)


@pytest.mark.parametrize('event',[50,51,52,150,151,152,350,351,364])
def test_tts_identifiers(event):
    frame=decode_tts_frame(tts(event,'identity'))
    assert frame.event==event and frame.session_id=='identity'


def test_tts_audio_error_and_client_events():
    assert decode_tts_frame(tts(352,'s',b'\0\1',True)).payload==b'\0\1'
    assert decode_tts_frame(b'\x11\xf0\x10\0'+struct.pack('!II',0xF0000001,2)+b'{}').error_code==0xF0000001
    assert encode_tts_event(1,{})[:8]==b'\x11\x14\x10\0\0\0\0\1'
    assert struct.unpack_from('!I',encode_tts_event(200,{'text':'你好'},'session'),8)[0]==7


@pytest.mark.asyncio
async def test_asr_buffer_commit_cumulative_and_final():
    socket=Socket([asr('你'),asr('你好'),asr('你好',True)]);stream=ASRStream(socket,'utterance')
    await stream.start()
    for _ in range(10): await stream.append(b'\0\0'*320)
    assert len(socket.sent)==2
    await stream.commit();await stream.commit()
    assert len(socket.sent)==3
    assert [(e.text,e.final) async for e in stream.events()]==[('你',False),('你好',False),('你好',True)]
    with pytest.raises(VoiceError): await stream.append(b'\0\0')
    await stream.close();assert socket.closed


@pytest.mark.asyncio
async def test_uncommitted_final_fails_closed():
    stream=ASRStream(Socket([asr('你好',True)]),'u')
    with pytest.raises(VoiceError): [event async for event in stream.events()]


@pytest.mark.asyncio
async def test_tts_incremental_text_and_odd_packet_reassembly():
    sid=str(uuid4());socket=Socket([tts(50,'c'),tts(150,sid),tts(352,sid,b'\1',True),tts(352,sid,b'\0\2\0',True),tts(152,sid)])
    stream=TTSStream(socket,sid,'configured-voice');await stream.start()
    await stream.append_text('第一句。');await stream.append_text('第二句。');await stream.finish()
    assert [struct.unpack_from('!I',x,4)[0] for x in socket.sent]==[1,100,200,200,102]
    assert b''.join([chunk async for chunk in stream.audio()])==b'\1\0\2\0' and stream.finished
    await stream.close();assert socket.closed


@pytest.mark.asyncio
async def test_tts_stale_id_and_odd_tail_rejected():
    for frames in [[tts(352,'wrong',b'\0\0',True)],[tts(352,'right',b'x',True),tts(152,'right')]]:
        stream=TTSStream(Socket(frames),'right','voice');stream.started=True;stream.finishing=True
        with pytest.raises(VoiceError): [chunk async for chunk in stream.audio()]


@pytest.mark.asyncio
async def test_cancel_closes_upstream():
    socket=Socket();stream=TTSStream(socket,'id','voice');stream.started=True
    await stream.close();await stream.close()
    assert socket.closed and len(socket.sent)==1 and struct.unpack_from('!I',socket.sent[0],4)[0]==101


@pytest.mark.asyncio
async def test_config_fails_before_network():
    calls=[]
    async def connector(*args,**kwargs): calls.append(args);return Socket()
    for flags in [{},{'pcm_layout_confirmed':True,'tts_url':'wss://untrusted.invalid'}]:
        config=VolcengineConfig('fake-key','owner-asr','owner-tts','owner-voice',**flags)
        with pytest.raises(VoiceError): await VolcengineProvider(config,connector=connector).open_asr('u')
    assert calls==[]


@pytest.mark.asyncio
async def test_open_failure_closes_socket_and_sanitizes_error():
    socket=Socket(fail_send=True)
    async def connector(*args,**kwargs):
        assert kwargs['additional_headers']['X-Api-Key']=='fake-key'
        assert 'X-Api-App-Id' not in kwargs['additional_headers']
        return socket
    config=VolcengineConfig('fake-key','owner-asr','owner-tts','voice',True)
    with pytest.raises(VoiceError) as caught: await VolcengineProvider(config,connector=connector).open_asr('u')
    assert socket.closed and str(caught.value)=='asr_unavailable' and 'secret' not in str(caught.value.event())


def test_supplier_config_repr_never_contains_key():
    config = VolcengineConfig(api_key='never-display-secret', asr_resource_id='asr',
                             tts_resource_id='tts', speaker='speaker')
    assert 'never-display-secret' not in repr(config)


@pytest.mark.asyncio
async def test_asr_busy_is_retryable_availability_not_quota():
    payload = b'busy'
    socket = Socket([b'\x11\xf0\x00\0' + struct.pack('!II', 55000031, len(payload)) + payload])
    with pytest.raises(VoiceError) as caught:
        [event async for event in ASRStream(socket, 'u').events()]
    assert caught.value.code == 'asr_unavailable' and caught.value.retryable


@pytest.mark.asyncio
async def test_asr_handshake_has_explicit_sequence_header():
    headers = []
    async def connector(*args, **kwargs):
        headers.append(kwargs['additional_headers'])
        return Socket()
    provider = VolcengineProvider(VolcengineConfig('fake', 'asr', 'tts', 'voice', True), connector=connector)
    stream = await provider.open_asr('u')
    assert headers[0]['X-Api-Sequence'] == '-1'
    await stream.close()


@pytest.mark.asyncio
async def test_completed_tts_finishes_connection_before_close():
    sid = str(uuid4())
    socket = Socket([tts(50, 'connection'), tts(150, sid), tts(152, sid), tts(52, 'connection')])
    stream = TTSStream(socket, sid, 'voice')
    await stream.start(); await stream.finish()
    assert [part async for part in stream.audio()] == []
    await stream.close()
    assert socket.closed and socket.frames == []
    assert [struct.unpack_from('!I', frame, 4)[0] for frame in socket.sent] == [1, 100, 102, 2]


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['asr', 'tts'])
async def test_failed_provider_close_is_visible_for_conservative_usage(kind):
    class FailingClose(Socket):
        async def close(self):
            raise OSError('do not expose supplier connection diagnostics')
    stream = ASRStream(FailingClose(), 'u') if kind == 'asr' else TTSStream(FailingClose(), 'r', 'voice')
    with pytest.raises(VoiceError) as caught:
        await stream.close()
    assert caught.value.code == kind + '_unavailable'
    assert 'diagnostics' not in str(caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['asr', 'tts'])
async def test_failed_open_failed_close_marks_cleanup_uncertain(kind):
    class FailedSocket(Socket):
        async def close(self): raise OSError('secret close diagnostics')
    socket = FailedSocket(fail_send=True)
    async def connector(*args, **kwargs): return socket
    provider = VolcengineProvider(VolcengineConfig('fake', 'asr', 'tts', 'voice', True), connector=connector)
    with pytest.raises(VoiceError) as caught:
        await getattr(provider, 'open_' + kind)('id')
    assert provider.cleanup_uncertain
    assert str(caught.value) == kind + '_unavailable'
    # A subsequent clean handshake failure cannot erase earlier uncertainty.
    socket.close = Socket().close
    with pytest.raises(VoiceError): await getattr(provider, 'open_' + kind)('second')
    assert provider.cleanup_uncertain


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['asr', 'tts'])
async def test_failed_open_successful_close_does_not_poison_accounting(kind):
    async def connector(*args, **kwargs): return Socket(fail_send=True)
    provider = VolcengineProvider(VolcengineConfig('fake', 'asr', 'tts', 'voice', True), connector=connector)
    with pytest.raises(VoiceError): await getattr(provider, 'open_' + kind)('id')
    assert not provider.cleanup_uncertain


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['asr', 'tts'])
async def test_cancelled_open_preserves_cancel_and_uncertain_close(kind):
    import asyncio
    started = asyncio.Event()
    class PendingSocket(Socket):
        async def send(self, value):
            started.set()
            await asyncio.Event().wait()
        async def close(self): raise OSError('secret close diagnostics')
    async def connector(*args, **kwargs): return PendingSocket()
    provider = VolcengineProvider(VolcengineConfig('fake', 'asr', 'tts', 'voice', True), connector=connector)
    task = asyncio.create_task(getattr(provider, 'open_' + kind)('id'))
    await started.wait(); task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert provider.cleanup_uncertain


@pytest.mark.asyncio
async def test_cancellation_while_failed_open_cleanup_is_pending_stays_uncertain():
    import asyncio
    closing = asyncio.Event()
    class PendingClose(Socket):
        async def close(self):
            closing.set()
            await asyncio.Event().wait()
    async def connector(*args, **kwargs): return PendingClose(fail_send=True)
    provider = VolcengineProvider(VolcengineConfig('fake', 'asr', 'tts', 'voice', True), connector=connector)
    task = asyncio.create_task(provider.open_asr('id'))
    await closing.wait()
    assert provider.cleanup_uncertain
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert provider.cleanup_uncertain


@pytest.mark.asyncio
async def test_cancelled_connector_without_returned_socket_is_conservative():
    import asyncio
    started = asyncio.Event()
    async def connector(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()
    provider = VolcengineProvider(VolcengineConfig('fake', 'asr', 'tts', 'voice', True), connector=connector)
    task = asyncio.create_task(provider.open_asr('id'))
    await started.wait(); task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert provider.cleanup_uncertain


@pytest.mark.asyncio
async def test_failed_open_cleanup_timeout_is_bounded_and_conservative():
    import asyncio
    class NeverCloses(Socket):
        async def close(self): await asyncio.Event().wait()
    async def connector(*args, **kwargs): return NeverCloses(fail_send=True)
    provider = VolcengineProvider(VolcengineConfig('fake', 'asr', 'tts', 'voice', True), connector=connector)
    with pytest.raises(VoiceError):
        await asyncio.wait_for(provider.open_asr('id'), timeout=3)
    assert provider.cleanup_uncertain
