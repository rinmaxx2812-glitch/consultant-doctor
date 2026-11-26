if (sessionStorage.getItem('consultant_admin_auth') !== 'true') {
    window.location.href = 'login.html';
}
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

const initialState = ConsultantSync.loadState();
let currentPatientId = initialState.currentPatientId || 'p_demo_1';
let activeRoomId = null;

let localStream = null;
let peerConnection = null;
let pendingCandidates = [];
let pendingCallVideo = true;
let callTimerInterval = null;
let secondsElapsed = 0;
let isMicMuted = false;
let isCamOff = false;

const patientListEl = document.getElementById('patientList');
const approvedCountEl = document.getElementById('approvedCount');
const activePatientName = document.getElementById('activePatientName');
const activePatientPhone = document.getElementById('activePatientPhone');
const chatTargetLabel = document.getElementById('chatTargetLabel');
const chatFeed = document.getElementById('chatFeed');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

const videoContainer = document.getElementById('videoContainer');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const pipBox = document.getElementById('pipBox');
const placeholderIcon = document.getElementById('placeholderIcon');
const placeholderTitle = document.getElementById('placeholderTitle');
const placeholderSub = document.getElementById('placeholderSub');
const callStatusBadge = document.getElementById('callStatusBadge');
const callTimerText = document.getElementById('callTimerText');

const btnVideoCall = document.getElementById('btnVideoCall');
const btnPhoneCall = document.getElementById('btnPhoneCall');
const btnToggleMic = document.getElementById('btnToggleMic');
const btnToggleCam = document.getElementById('btnToggleCam');
const btnEndCall = document.getElementById('btnEndCall');

let remoteAudioEl = document.getElementById('remoteAudioFallback');
if (!remoteAudioEl) {
    remoteAudioEl = document.createElement('audio');
    remoteAudioEl.id = 'remoteAudioFallback';
    remoteAudioEl.autoplay = true;
    document.body.appendChild(remoteAudioEl);
}

// Incoming Call UI (HTML မပြင်ဘဲ JS မှ အလိုအလျောက် ဖန်တီးထည့်ပေးသည်)
const incomingCallBox = document.createElement('div');
incomingCallBox.id = 'incomingCallBox';
incomingCallBox.style.cssText = `
    display: none;
    position: fixed;
    top: 20px;
    right: 20px;
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
incomingCallBox.innerHTML = `
    <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;" id="adminIncomingTitle">Incoming Call</div>
    <div style="font-size: 13px; color: #cbd5e1; margin-bottom: 14px;" id="adminIncomingSub">Patient is calling...</div>
    <div style="display: flex; gap: 10px;">
        <button type="button" id="adminAcceptCallBtn" style="flex: 1; background: #16a34a; color: #fff; border: none; padding: 9px 14px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            Accept
        </button>
        <button type="button" id="adminDeclineCallBtn" style="flex: 1; background: #dc2626; color: #fff; border: none; padding: 9px 14px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            Decline
        </button>
    </div>
`;
document.body.appendChild(incomingCallBox);

const adminIncomingTitle = document.getElementById('adminIncomingTitle');
const adminIncomingSub = document.getElementById('adminIncomingSub');
const adminAcceptCallBtn = document.getElementById('adminAcceptCallBtn');
const adminDeclineCallBtn = document.getElementById('adminDeclineCallBtn');

function showIncomingPrompt(title, sub) {
    adminIncomingTitle.textContent = title;
    adminIncomingSub.textContent = sub;
    incomingCallBox.style.display = 'block';
}

function hideIncomingPrompt() {
    incomingCallBox.style.display = 'none';
}

function getRoomIdForPatient(patientId) {
    return patientId ? `consult_room_${patientId}` : null;
}

function joinPatientRoom() {
    const nextRoom = getRoomIdForPatient(currentPatientId);
    if (!nextRoom || nextRoom === activeRoomId) return;
    activeRoomId = nextRoom;
    socket.emit('join-room', { roomId: activeRoomId, role: 'doctor' });
}

function getInitials(name) {
    return (name || 'PT')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('') || 'PT';
}

function renderApprovedPatients() {
    const all = ConsultantSync.getAllPatients();
    const approved = all.filter(p => p.paymentStatus === 'approved');

    approvedCountEl.textContent = `${approved.length} Approved`;
    patientListEl.innerHTML = '';

    if (approved.length === 0) {
        currentPatientId = null;
        activeRoomId = null;
        patientListEl.innerHTML = '<p class="panel-note">No approved patients yet.</p>';
        return;
    }

    if (!approved.some(p => p.id === currentPatientId)) {
        currentPatientId = approved[0].id;
    }

    approved.forEach((p, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `patient-item ${p.id === currentPatientId ? 'active' : ''}`;
        btn.innerHTML = `
            <div class="avatar ${idx % 2 === 1 ? 'alt' : ''}">${getInitials(p.name)}</div>
            <div class="patient-info">
                <strong>${p.name}</strong>
                <span>${p.phone}</span>
            </div>
            <span class="status-dot online"></span>
        `;
        btn.addEventListener('click', () => {
            if (currentPatientId !== p.id) {
                endCall(true);
                hideIncomingPrompt();
            }
            currentPatientId = p.id;
            const latestState = ConsultantSync.loadState();
            latestState.currentPatientId = currentPatientId;
            localStorage.setItem('consultant_doctor_state_v1', JSON.stringify(latestState));
            renderAll();
            joinPatientRoom();
        });
        patientListEl.appendChild(btn);
    });
}

function renderActivePatientHeader() {
    const state = ConsultantSync.loadState();
    const p = currentPatientId ? state.patients[currentPatientId] : null;
    if (!p) {
        activePatientName.textContent = 'No Approved Patient';
        activePatientPhone.textContent = 'Approve a patient from Dashboard to start';
        chatTargetLabel.textContent = 'No active chat';
        return;
    }

    activePatientName.textContent = p.name;
    activePatientPhone.textContent = `${p.phone} • KPay Verified (10,000 MMK)`;
    chatTargetLabel.textContent = `Chatting with ${p.name}`;
}

function renderChat() {
    chatFeed.innerHTML = '';
    if (!currentPatientId) {
        chatFeed.innerHTML = '<p class="panel-note">No chat messages available.</p>';
        return;
    }

    const messages = ConsultantSync.getChats(currentPatientId);
    messages.forEach(msg => {
        const row = document.createElement('div');
        row.className = `msg-row ${msg.sender}`;

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.innerHTML = `
            <p>${msg.text}</p>
            <span class="msg-time">${msg.time}</span>
        `;

        row.appendChild(bubble);
        chatFeed.appendChild(row);
    });

    chatFeed.scrollTop = chatFeed.scrollHeight;
}

function sendDoctorMessage(text) {
    if (!text.trim() || !currentPatientId) return;
    ConsultantSync.sendChatMessage(currentPatientId, 'doctor', text);
    renderChat();
}

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendDoctorMessage(chatInput.value);
    chatInput.value = '';
});

document.querySelectorAll('.quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        sendDoctorMessage(chip.dataset.quick);
    });
});

function renderAll() {
    renderApprovedPatients();
    renderActivePatientHeader();
    renderChat();
    joinPatientRoom();
}

renderAll();
ConsultantSync.subscribe(renderAll);

socket.on('connect', () => {
    if (activeRoomId) {
        socket.emit('join-room', { roomId: activeRoomId, role: 'doctor' });
    }
});

// ================= WEBRTC VIDEO & PHONE CALL WITH ACCEPT/DECLINE =================
function startTimer() {
    stopTimer();
    secondsElapsed = 0;
    callStatusBadge.classList.add('live');
    callTimerText.textContent = '00:00';

    callTimerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const secs = String(secondsElapsed % 60).padStart(2, '0');
        callTimerText.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callStatusBadge.classList.remove('live');
    callTimerText.textContent = 'Standby';
}

function setupDoctorMediaUI(withVideo, titleText, subText) {
    isMicMuted = false;
    isCamOff = !withVideo;
    btnToggleMic.disabled = false;
    btnToggleCam.disabled = !withVideo;
    btnEndCall.disabled = false;

    btnToggleMic.classList.remove('muted-state');
    btnToggleMic.innerHTML = '<i class="fa-solid fa-microphone"></i><span>Mic On</span>';

    if (withVideo) {
        localVideo.srcObject = localStream;
        pipBox.classList.add('visible');
        btnToggleCam.classList.remove('muted-state');
        btnToggleCam.innerHTML = '<i class="fa-solid fa-camera"></i><span>Cam On</span>';

        placeholderIcon.className = 'placeholder-icon ringing';
        placeholderIcon.innerHTML = '<i class="fa-solid fa-video"></i>';
    } else {
        pipBox.classList.remove('visible');
        placeholderIcon.className = 'placeholder-icon ringing';
        placeholderIcon.innerHTML = '<i class="fa-solid fa-phone-volume"></i>';
    }

    placeholderTitle.textContent = titleText;
    placeholderSub.textContent = subText;
}

function createPeerConnection(withVideo) {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    pendingCandidates = [];

    const pc = new RTCPeerConnection(RTC_CONFIG);

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate && activeRoomId) {
            socket.emit('webrtc-ice-candidate', {
                roomId: activeRoomId,
                candidate: event.candidate
            });
        }
    };

    pc.ontrack = (event) => {
        const [incomingStream] = event.streams;
        if (!incomingStream) return;

        if (remoteVideo && withVideo) {
            remoteVideo.srcObject = incomingStream;
        }
        remoteAudioEl.srcObject = incomingStream;
        remoteAudioEl.play().catch(() => {});

        placeholderTitle.textContent = withVideo
            ? `Live Video Call with ${activePatientName.textContent}`
            : `Live Phone Call with ${activePatientName.textContent}`;
        placeholderSub.textContent = 'Connected directly via WebRTC.';
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            endCall(false);
        }
    };

    peerConnection = pc;
    return pc;
}

async function flushPendingCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    while (pendingCandidates.length > 0) {
        const cand = pendingCandidates.shift();
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
            console.error('ICE error:', e);
        }
    }
}

// Step 1 (Outgoing): Doctor clicks Video Call / Phone Call -> waits for patient to accept
async function startCall(withVideo) {
    if (!currentPatientId) {
        alert('ကျေးဇူးပြု၍ Approved ဖြစ်ပြီးသား လူနာတစ်ဦးကို အရင်ရွေးချယ်ပါ။');
        return;
    }

    joinPatientRoom();
    endCall(false);
    hideIncomingPrompt();
    pendingCallVideo = withVideo;

    btnEndCall.disabled = false;
    placeholderIcon.className = 'placeholder-icon ringing';
    placeholderIcon.innerHTML = withVideo
        ? '<i class="fa-solid fa-video"></i>'
        : '<i class="fa-solid fa-phone-volume"></i>';
    placeholderTitle.textContent = `Calling ${activePatientName.textContent}...`;
    placeholderSub.textContent = 'Waiting for patient to accept the call...';

    socket.emit('call-request', {
        roomId: activeRoomId,
        withVideo,
        callerName: 'Dr. La Yaung'
    });
}

// Step 2 (Outgoing): Patient accepted -> Doctor acquires media & sends WebRTC offer
async function sendOfferAfterAccept(withVideo) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: withVideo,
            audio: true
        });

        setupDoctorMediaUI(
            withVideo,
            `Connecting ${withVideo ? 'Video' : 'Phone'} Call with ${activePatientName.textContent}...`,
            'Call accepted. Establishing media stream...'
        );

        const pc = createPeerConnection(withVideo);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', {
            roomId: activeRoomId,
            offer,
            withVideo
        });

        startTimer();
    } catch (err) {
        endCall(true);
        alert('Camera/Microphone ခွင့်ပြုချက် (Permission) မရရှိပါ။ Browser settings တွင် Allow ပြုလုပ်ပေးပါ။');
    }
}

// Step 1 (Incoming): Patient calls Doctor -> show Accept / Decline prompt
socket.on('call-request', ({ withVideo, callerName }) => {
    pendingCallVideo = Boolean(withVideo);
    const callType = pendingCallVideo ? 'Video Call' : 'Phone Call';
    showIncomingPrompt(
        `Incoming ${callType}`,
        `${callerName || activePatientName.textContent || 'Patient'} is calling you...`
    );
});

adminAcceptCallBtn.addEventListener('click', async () => {
    hideIncomingPrompt();
    if (!activeRoomId) joinPatientRoom();
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: pendingCallVideo,
            audio: true
        });
        setupDoctorMediaUI(
            pendingCallVideo,
            `${pendingCallVideo ? 'Video' : 'Phone'} Call Connected`,
            'Preparing connection...'
        );
        createPeerConnection(pendingCallVideo);
        btnEndCall.disabled = false;
        startTimer();
        socket.emit('call-accepted', {
            roomId: activeRoomId,
            withVideo: pendingCallVideo
        });
    } catch (err) {
        alert('Camera/Microphone ခွင့်ပြုချက် (Permission) မရရှိပါ။');
    }
});

adminDeclineCallBtn.addEventListener('click', () => {
    hideIncomingPrompt();
    if (activeRoomId) {
        socket.emit('call-declined', { roomId: activeRoomId });
    }
});

socket.on('call-accepted', async ({ withVideo }) => {
    const useVideo = typeof withVideo === 'boolean' ? withVideo : pendingCallVideo;
    await sendOfferAfterAccept(useVideo);
});

socket.on('call-declined', () => {
    endCall(false);
    alert('လူနာဘက်မှ ခေါ်ဆိုမှုကို ငြင်းပယ်လိုက်ပါသည်။');
});

socket.on('webrtc-offer', async ({ offer, withVideo }) => {
    if (!offer) return;
    if (!peerConnection) {
        const useVideo = Boolean(withVideo);
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: useVideo,
                    audio: true
                });
                setupDoctorMediaUI(useVideo, 'Call Connected', 'Connecting stream...');
                startTimer();
            } catch (e) {
                return;
            }
        }
        createPeerConnection(useVideo);
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    await flushPendingCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc-answer', {
        roomId: activeRoomId,
        answer
    });
});

socket.on('webrtc-answer', async ({ answer }) => {
    if (!peerConnection || !answer) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingCandidates();
});

socket.on('webrtc-ice-candidate', async ({ candidate }) => {
    if (!candidate) return;
    if (peerConnection && peerConnection.remoteDescription) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Failed adding ICE:', e);
        }
    } else {
        pendingCandidates.push(candidate);
    }
});

socket.on('end-call', () => {
    hideIncomingPrompt();
    endCall(false);
});

socket.on('peer-left', () => {
    hideIncomingPrompt();
    if (peerConnection) {
        endCall(false);
    }
});

function endCall(notifyPeer = true) {
    hideIncomingPrompt();

    if (notifyPeer && activeRoomId) {
        socket.emit('end-call', { roomId: activeRoomId });
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    pendingCandidates = [];

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    remoteAudioEl.srcObject = null;
    pipBox.classList.remove('visible');

    btnToggleMic.disabled = true;
    btnToggleCam.disabled = true;
    btnEndCall.disabled = true;
    btnToggleMic.classList.remove('muted-state');
    btnToggleCam.classList.remove('muted-state');

    placeholderIcon.className = 'placeholder-icon';
    placeholderIcon.innerHTML = '<i class="fa-solid fa-user-injured"></i>';
    placeholderTitle.textContent = 'Waiting to Start Call';
    placeholderSub.textContent = 'Click "Video Call" or "Phone Call" below to connect directly with the patient';

    stopTimer();
}

btnVideoCall.addEventListener('click', () => startCall(true));
btnPhoneCall.addEventListener('click', () => startCall(false));
btnEndCall.addEventListener('click', () => endCall(true));

btnToggleMic.addEventListener('click', () => {
    if (!localStream) return;
    isMicMuted = !isMicMuted;
    localStream.getAudioTracks().forEach(track => (track.enabled = !isMicMuted));

    if (isMicMuted) {
        btnToggleMic.classList.add('muted-state');
        btnToggleMic.innerHTML = '<i class="fa-solid fa-microphone-slash"></i><span>Muted</span>';
    } else {
        btnToggleMic.classList.remove('muted-state');
        btnToggleMic.innerHTML = '<i class="fa-solid fa-microphone"></i><span>Mic On</span>';
    }
});

btnToggleCam.addEventListener('click', () => {
    if (!localStream) return;
    isCamOff = !isCamOff;
    localStream.getVideoTracks().forEach(track => (track.enabled = !isCamOff));

    if (isCamOff) {
        btnToggleCam.classList.add('muted-state');
        btnToggleCam.innerHTML = '<i class="fa-solid fa-video-slash"></i><span>Cam Off</span>';
        pipBox.classList.remove('visible');
    } else {
        btnToggleCam.classList.remove('muted-state');
        btnToggleCam.innerHTML = '<i class="fa-solid fa-camera"></i><span>Cam On</span>';
        pipBox.classList.add('visible');
    }
});