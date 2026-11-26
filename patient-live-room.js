const SIGNALING_URL =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3001'
        : 'https://rinmaxx2812-glitch.github.io/consultant-server';
const socket = io(SIGNALING_URL, { autoConnect: true });

const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const currentPatient = ConsultantSync.getCurrentPatient();

// Guard: Only approved patients can stay in Live Room
if (!currentPatient || currentPatient.paymentStatus !== 'approved') {
    window.location.href = 'payment.html';
}

const patientId = currentPatient.id;
const roomId = `consult_room_${patientId}`;
const patientName = currentPatient.name || 'Patient';
const patientPhone = currentPatient.phone || '09xxxxxxxxx';

const patientDisplayName = document.getElementById('patientDisplayName');
const patientDisplayPhone = document.getElementById('patientDisplayPhone');
const patientAvatar = document.getElementById('patientAvatar');

patientDisplayName.textContent = patientName;
patientDisplayPhone.textContent = `Phone: ${patientPhone} • Consulting with Dr. La Yaung`;
patientAvatar.textContent = patientName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || 'PT';

// Chat State Sync
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

function renderPatientChats() {
    const msgs = ConsultantSync.getChats(patientId);
    chatMessages.innerHTML = '';

    msgs.forEach(msg => {
        const row = document.createElement('div');
        row.className = `msg-row ${msg.sender}`;

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.innerHTML = `<p>${msg.text}</p><span class="msg-time">${msg.time}</span>`;

        row.appendChild(bubble);
        chatMessages.appendChild(row);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendPatientMessage(text) {
    if (!text.trim()) return;
    ConsultantSync.sendChatMessage(patientId, 'patient', text);
    renderPatientChats();
}

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendPatientMessage(chatInput.value);
    chatInput.value = '';
});

document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        sendPatientMessage(btn.dataset.msg);
    });
});

renderPatientChats();
ConsultantSync.subscribe(() => {
    const updated = ConsultantSync.getCurrentPatient();
    if (!updated || updated.paymentStatus !== 'approved') {
        window.location.href = 'payment.html';
        return;
    }
    renderPatientChats();
});

// Direct WebRTC Call Controls + Incoming Call Accept/Decline
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const pipPreview = document.getElementById('pipPreview');
const iconRing = document.getElementById('iconRing');
const placeholderTitle = document.getElementById('placeholderTitle');
const placeholderDesc = document.getElementById('placeholderDesc');
const callStatusPill = document.getElementById('callStatusPill');
const callTimer = document.getElementById('callTimer');

const btnVideoCall = document.getElementById('btnVideoCall');
const btnPhoneCall = document.getElementById('btnPhoneCall');
const btnMic = document.getElementById('btnMic');
const btnCam = document.getElementById('btnCam');
const btnEndCall = document.getElementById('btnEndCall');

let remoteAudioEl = document.getElementById('patientRemoteAudio');
if (!remoteAudioEl) {
    remoteAudioEl = document.createElement('audio');
    remoteAudioEl.id = 'patientRemoteAudio';
    remoteAudioEl.autoplay = true;
    document.body.appendChild(remoteAudioEl);
}

// Incoming Call Box for Patient
const patientIncomingBox = document.createElement('div');
patientIncomingBox.id = 'patientIncomingBox';
patientIncomingBox.style.cssText = `
    display: none;
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 9999;
    background: #0f172a;
    color: #ffffff;
    padding: 16px 20px;
    border-radius: 14px;
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.14);
    min-width: 290px;
    font-family: inherit;
`;
patientIncomingBox.innerHTML = `
    <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;" id="patientIncomingTitle">Incoming Call from Doctor</div>
    <div style="font-size: 13px; color: #cbd5e1; margin-bottom: 14px;" id="patientIncomingSub">Dr. La Yaung is calling you...</div>
    <div style="display: flex; gap: 10px;">
        <button type="button" id="patientAcceptCallBtn" style="flex: 1; background: #16a34a; color: #fff; border: none; padding: 9px 14px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            Accept
        </button>
        <button type="button" id="patientDeclineCallBtn" style="flex: 1; background: #dc2626; color: #fff; border: none; padding: 9px 14px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            Decline
        </button>
    </div>
`;
document.body.appendChild(patientIncomingBox);

const patientIncomingTitle = document.getElementById('patientIncomingTitle');
const patientIncomingSub = document.getElementById('patientIncomingSub');
const patientAcceptCallBtn = document.getElementById('patientAcceptCallBtn');
const patientDeclineCallBtn = document.getElementById('patientDeclineCallBtn');

function showPatientIncoming(title, sub) {
    patientIncomingTitle.textContent = title;
    patientIncomingSub.textContent = sub;
    patientIncomingBox.style.display = 'block';
}

function hidePatientIncoming() {
    patientIncomingBox.style.display = 'none';
}

let stream = null;
let pc = null;
let pendingIce = [];
let incomingUseVideo = true;
let queuedOffer = null;
let timerId = null;
let sec = 0;
let micMuted = false;
let camOff = false;

socket.emit('join-room', { roomId, role: 'patient' });
socket.on('connect', () => {
    socket.emit('join-room', { roomId, role: 'patient' });
});

function startCallTimer() {
    stopCallTimer();
    sec = 0;
    callStatusPill.classList.add('live');
    callTimer.textContent = '00:00';
    timerId = setInterval(() => {
        sec++;
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        callTimer.textContent = `${m}:${s}`;
    }, 1000);
}

function stopCallTimer() {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
    callStatusPill.classList.remove('live');
    callTimer.textContent = 'Standby';
}

function setupMediaUI(useVideo, titleText, descText) {
    micMuted = false;
    camOff = !useVideo;

    btnMic.disabled = false;
    btnCam.disabled = !useVideo;
    btnEndCall.disabled = false;
    btnMic.classList.remove('muted');
    btnMic.innerHTML = '<i class="fa-solid fa-microphone"></i><span>Mic On</span>';

    if (useVideo) {
        localVideo.srcObject = stream;
        pipPreview.classList.add('visible');
        btnCam.classList.remove('muted');
        btnCam.innerHTML = '<i class="fa-solid fa-camera"></i><span>Cam On</span>';

        iconRing.className = 'icon-ring active-ring';
        iconRing.innerHTML = '<i class="fa-solid fa-video"></i>';
    } else {
        pipPreview.classList.remove('visible');
        iconRing.className = 'icon-ring active-ring';
        iconRing.innerHTML = '<i class="fa-solid fa-phone-volume"></i>';
    }

    placeholderTitle.textContent = titleText;
    placeholderDesc.textContent = descText;
}

function initPeerConnection(useVideo) {
    if (pc) {
        pc.close();
        pc = null;
    }
    pendingIce = [];

    const connection = new RTCPeerConnection(RTC_CONFIG);

    if (stream) {
        stream.getTracks().forEach(t => connection.addTrack(t, stream));
    }

    connection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-ice-candidate', {
                roomId,
                candidate: event.candidate
            });
        }
    };

    connection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        if (remoteVideo && useVideo) {
            remoteVideo.srcObject = remoteStream;
        }
        remoteAudioEl.srcObject = remoteStream;
        remoteAudioEl.play().catch(() => {});

        placeholderTitle.textContent = useVideo
            ? 'Video Call Connected with Dr. La Yaung'
            : 'Phone Call Connected with Dr. La Yaung';
        placeholderDesc.textContent = 'Live audio/video stream active.';
    };

    connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') {
            hangUpCall(false);
        }
    };

    pc = connection;
    return connection;
}

async function flushPatientIce() {
    if (!pc || !pc.remoteDescription) return;
    while (pendingIce.length > 0) {
        const c = pendingIce.shift();
        try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (err) {
            console.error('ICE error:', err);
        }
    }
}

// Patient calls Doctor -> waits for Doctor to accept
async function beginCall(useVideo) {
    hangUpCall(false);
    hidePatientIncoming();
    incomingUseVideo = useVideo;

    btnEndCall.disabled = false;
    iconRing.className = 'icon-ring active-ring';
    iconRing.innerHTML = useVideo
        ? '<i class="fa-solid fa-video"></i>'
        : '<i class="fa-solid fa-phone-volume"></i>';
    placeholderTitle.textContent = useVideo
        ? 'Calling Dr. La Yaung (Video)...'
        : 'Calling Dr. La Yaung (Phone)...';
    placeholderDesc.textContent = 'Waiting for Dr. La Yaung to accept...';

    socket.emit('call-request', {
        roomId,
        withVideo: useVideo,
        callerName: patientName
    });
}

// Doctor accepted -> Patient acquires media & sends WebRTC offer
socket.on('call-accepted', async ({ withVideo }) => {
    const useVideo = typeof withVideo === 'boolean' ? withVideo : incomingUseVideo;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: useVideo, audio: true });
        setupMediaUI(
            useVideo,
            `Connecting ${useVideo ? 'Video' : 'Phone'} Call...`,
            'Call accepted. Connecting media stream...'
        );

        const connection = initPeerConnection(useVideo);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socket.emit('webrtc-offer', {
            roomId,
            offer,
            withVideo: useVideo
        });

        startCallTimer();
    } catch (err) {
        hangUpCall(true);
        alert('Camera/Microphone ခွင့်ပြုချက် (Permission) မရရှိပါ။ Browser settings တွင် Allow ပြုလုပ်ပေးပါ။');
    }
});

socket.on('call-declined', () => {
    hangUpCall(false);
    alert('ဆရာဝန်ဘက်မှ ခေါ်ဆိုမှုကို ငြင်းပယ်လိုက်ပါသည်။');
});

// Doctor calls Patient -> show Accept / Decline prompt
socket.on('call-request', ({ withVideo, callerName }) => {
    incomingUseVideo = Boolean(withVideo);
    const modeLabel = incomingUseVideo ? 'Video Call' : 'Phone Call';
    showPatientIncoming(
        `Incoming ${modeLabel}`,
        `${callerName || 'Dr. La Yaung'} is calling you...`
    );
});

async function completeIncomingOffer(offer, useVideo) {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: useVideo, audio: true });
        setupMediaUI(
            useVideo,
            useVideo ? 'Video Call Connected with Dr. La Yaung' : 'Phone Call Connected with Dr. La Yaung',
            'Connecting call...'
        );

        const connection = initPeerConnection(useVideo);
        await connection.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPatientIce();

        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.emit('webrtc-answer', { roomId, answer });

        startCallTimer();
    } catch (err) {
        hangUpCall(true);
        alert('ခေါ်ဆိုမှု လက်ခံရန် Camera/Microphone ခွင့်ပြုချက် လိုအပ်ပါသည်။');
    }
}

patientAcceptCallBtn.addEventListener('click', async () => {
    hidePatientIncoming();
    socket.emit('call-accepted', {
        roomId,
        withVideo: incomingUseVideo
    });

    if (queuedOffer) {
        const offerToUse = queuedOffer;
        queuedOffer = null;
        await completeIncomingOffer(offerToUse, incomingUseVideo);
    } else {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: incomingUseVideo, audio: true });
            setupMediaUI(
                incomingUseVideo,
                `${incomingUseVideo ? 'Video' : 'Phone'} Call Accepted`,
                'Waiting for doctor stream...'
            );
            initPeerConnection(incomingUseVideo);
            startCallTimer();
        } catch (err) {
            alert('Camera/Microphone ခွင့်ပြုချက် လိုအပ်ပါသည်။');
        }
    }
});

patientDeclineCallBtn.addEventListener('click', () => {
    hidePatientIncoming();
    queuedOffer = null;
    socket.emit('call-declined', { roomId });
});

socket.on('webrtc-offer', async ({ offer, withVideo }) => {
    if (!offer) return;
    const useVideo = typeof withVideo === 'boolean' ? withVideo : incomingUseVideo;

    if (pc && stream) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPatientIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', { roomId, answer });
    } else if (patientIncomingBox.style.display === 'block') {
        queuedOffer = offer;
    } else {
        queuedOffer = offer;
        incomingUseVideo = useVideo;
        showPatientIncoming(
            `Incoming ${useVideo ? 'Video Call' : 'Phone Call'}`,
            'Dr. La Yaung is calling you...'
        );
    }
});

socket.on('webrtc-answer', async ({ answer }) => {
    if (!pc || !answer) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPatientIce();
});

socket.on('webrtc-ice-candidate', async ({ candidate }) => {
    if (!candidate) return;
    if (pc && pc.remoteDescription) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error('ICE error:', err);
        }
    } else {
        pendingIce.push(candidate);
    }
});

socket.on('end-call', () => {
    hidePatientIncoming();
    queuedOffer = null;
    hangUpCall(false);
});

socket.on('peer-left', () => {
    hidePatientIncoming();
    queuedOffer = null;
    if (pc) {
        hangUpCall(false);
    }
});

function hangUpCall(notifyPeer = true) {
    hidePatientIncoming();
    queuedOffer = null;

    if (notifyPeer && roomId) {
        socket.emit('end-call', { roomId });
    }

    if (pc) {
        pc.close();
        pc = null;
    }
    pendingIce = [];

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    remoteAudioEl.srcObject = null;
    pipPreview.classList.remove('visible');

    btnMic.disabled = true;
    btnCam.disabled = true;
    btnEndCall.disabled = true;
    btnMic.classList.remove('muted');
    btnCam.classList.remove('muted');

    iconRing.className = 'icon-ring';
    iconRing.innerHTML = '<i class="fa-solid fa-user-doctor"></i>';
    placeholderTitle.textContent = 'Dr. La Yaung is Ready';
    placeholderDesc.textContent = 'Video Call သို့မဟုတ် Phone Call ခလုတ်ကို နှိပ်၍ တိုက်ရိုက်ခေါ်ဆိုနိုင်ပါသည်';

    stopCallTimer();
}

btnVideoCall.addEventListener('click', () => beginCall(true));
btnPhoneCall.addEventListener('click', () => beginCall(false));
btnEndCall.addEventListener('click', () => hangUpCall(true));

btnMic.addEventListener('click', () => {
    if (!stream) return;
    micMuted = !micMuted;
    stream.getAudioTracks().forEach(t => (t.enabled = !micMuted));
    btnMic.classList.toggle('muted', micMuted);
    btnMic.innerHTML = micMuted
        ? '<i class="fa-solid fa-microphone-slash"></i><span>Muted</span>'
        : '<i class="fa-solid fa-microphone"></i><span>Mic On</span>';
});

btnCam.addEventListener('click', () => {
    if (!stream) return;
    camOff = !camOff;
    stream.getVideoTracks().forEach(t => (t.enabled = !camOff));
    btnCam.classList.toggle('muted', camOff);
    pipPreview.classList.toggle('visible', !camOff);
    btnCam.innerHTML = camOff
        ? '<i class="fa-solid fa-video-slash"></i><span>Cam Off</span>'
        : '<i class="fa-solid fa-camera"></i><span>Cam On</span>';
});