// ================= CONSULTANT DOCTOR REAL-TIME SYNC ENGINE =================
const ConsultantSync = (() => {
    const STORAGE_KEY = 'consultant_doctor_state_v1';
    const CHANNEL_NAME = 'consultant_doctor_channel_v1';
    const SIGNALING_URL =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3001'
        : 'https://rinmaxx2812-glitch.github.io/consultant-server';

    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    const socket = typeof io !== 'undefined' ? io(SIGNALING_URL, { autoConnect: true }) : null;
    const listeners = new Set();

    function notifySubscribers() {
        const latest = loadState();
        listeners.forEach(cb => cb(latest));
    }

    function getDefaultState() {
        return {
            currentPatientId: 'p_demo_1',
            patients: {
                p_demo_1: {
                    id: 'p_demo_1',
                    name: 'Su Myat Aung',
                    phone: '09 420 987 654',
                    submittedAt: '19 Nov 2026, 10:20 AM',
                    paymentStatus: 'approved', // 'none' | 'pending' | 'approved' | 'rejected'
                    screenshotDataUrl: ''
                }
            },
            chats: {
                p_demo_1: [
                    { id: 'm_seed_1', sender: 'patient', text: 'မင်္ဂလာပါ ဆရာ။ ခေါင်းကိုက်ပြီး ဖျားနေတာ နှစ်ရက်ရှိပါပြီ။', time: '10:22 AM' },
                    { id: 'm_seed_2', sender: 'doctor', text: 'မင်္ဂလာပါ။ အဖျားဘယ်လောက်ရှိလဲ၊ လည်ချောင်းနာတာ ချောင်းဆိုးတာရော ရှိပါသလား။', time: '10:23 AM' }
                ]
            }
        };
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                const initial = getDefaultState();
                saveState(initial, false, false);
                return initial;
            }
            const parsed = JSON.parse(raw);
            return {
                currentPatientId: parsed.currentPatientId || 'p_demo_1',
                patients: parsed.patients || {},
                chats: parsed.chats || {}
            };
        } catch (err) {
            return getDefaultState();
        }
    }

    function mergeStates(baseState, incomingState) {
        if (!incomingState) return baseState;

        const mergedPatients = { ...(baseState.patients || {}) };
        Object.entries(incomingState.patients || {}).forEach(([id, p]) => {
            mergedPatients[id] = {
                ...(mergedPatients[id] || {}),
                ...p
            };
        });

        const mergedChats = { ...(baseState.chats || {}) };
        Object.entries(incomingState.chats || {}).forEach(([patientId, incomingMsgs]) => {
            const existingMsgs = mergedChats[patientId] || [];
            const seenKeys = new Set(
                existingMsgs.map(m => m.id || `${m.sender}|${m.text}|${m.time}`)
            );

            const combined = [...existingMsgs];
            (incomingMsgs || []).forEach(m => {
                const key = m.id || `${m.sender}|${m.text}|${m.time}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    combined.push(m);
                }
            });
            mergedChats[patientId] = combined;
        });

        return {
            currentPatientId: baseState.currentPatientId || incomingState.currentPatientId || 'p_demo_1',
            patients: mergedPatients,
            chats: mergedChats
        };
    }

    function saveState(state, notify = true, emitRemote = true) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

        if (notify && channel) {
            channel.postMessage({ type: 'STATE_UPDATED', state });
        }

        if (emitRemote && socket && socket.connected) {
            const roomId = state.currentPatientId ? `consult_room_${state.currentPatientId}` : null;
            socket.emit('sync-state', { roomId, state });
        }

        if (notify) {
            notifySubscribers();
        }
    }

    function formatTimeNow() {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatDateTimeNow() {
        return new Date().toLocaleString([], {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Step 1: Register or update current patient
    function registerPatient(name, phone) {
        const state = loadState();
        const safePhone = phone.trim();
        const existingId = Object.keys(state.patients).find(
            id => state.patients[id].phone.replace(/\s+/g, '') === safePhone.replace(/\s+/g, '')
        );

        const patientId = existingId || `p_${Date.now()}`;
        const prev = state.patients[patientId];

        state.patients[patientId] = {
            id: patientId,
            name: name.trim(),
            phone: safePhone,
            submittedAt: prev?.submittedAt || formatDateTimeNow(),
            paymentStatus: prev?.paymentStatus === 'approved' ? 'approved' : 'none',
            screenshotDataUrl: prev?.screenshotDataUrl || ''
        };

        if (!state.chats[patientId]) {
            state.chats[patientId] = [];
        }

        state.currentPatientId = patientId;
        sessionStorage.setItem('consultant_patient_info', JSON.stringify({
            id: patientId,
            name: name.trim(),
            phone: safePhone
        }));

        saveState(state, true, true);
        return state.patients[patientId];
    }

    function getCurrentPatient() {
        const state = loadState();
        const sessionInfo = JSON.parse(sessionStorage.getItem('consultant_patient_info') || 'null');
        const id = sessionInfo?.id || state.currentPatientId;
        return state.patients[id] || null;
    }

    // Step 2: Patient submits KPay screenshot -> status becomes 'pending'
    function submitPaymentScreenshot(patientId, screenshotDataUrl) {
        const state = loadState();
        if (!state.patients[patientId]) return null;

        state.patients[patientId].paymentStatus = 'pending';
        state.patients[patientId].screenshotDataUrl = screenshotDataUrl;
        state.patients[patientId].submittedAt = formatDateTimeNow();

        saveState(state, true, true);
        return state.patients[patientId];
    }

    // Admin action: 'approved' | 'rejected'
    function setPaymentStatus(patientId, status) {
        const state = loadState();
        if (!state.patients[patientId]) return null;

        state.patients[patientId].paymentStatus = status;

        if (status === 'approved') {
            if (!state.chats[patientId]) state.chats[patientId] = [];
            const hasWelcome = state.chats[patientId].some(m => m.systemWelcome);
            if (!hasWelcome) {
                state.chats[patientId].push({
                    id: `msg_welcome_${patientId}`,
                    sender: 'doctor',
                    text: `မင်္ဂလာပါ ${state.patients[patientId].name}။ KPay ငွေပေးချေမှု အတည်ပြုပြီးပါပြီ။ လက်ရှိခံစားနေရတဲ့ ကျန်းမာရေးအခြေအနေကို ဒီမှာ ရေးပို့နိုင်သလို Video Call / Phone Call ဖြင့်လည်း ဆွေးနွေးနိုင်ပါတယ်။`,
                    time: formatTimeNow(),
                    systemWelcome: true
                });
            }
        }

        saveState(state, true, true);
        return state.patients[patientId];
    }

    // Chat send ('patient' | 'doctor')
    function sendChatMessage(patientId, sender, text) {
        const clean = text.trim();
        if (!clean || !patientId) return null;

        const state = loadState();
        if (!state.chats[patientId]) {
            state.chats[patientId] = [];
        }

        const msg = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            sender,
            text: clean,
            time: formatTimeNow()
        };

        state.chats[patientId].push(msg);
        saveState(state, true, true);

        if (socket && socket.connected) {
            socket.emit('chat-message', {
                roomId: `consult_room_${patientId}`,
                patientId,
                message: msg
            });
        }

        return msg;
    }

    function getChats(patientId) {
        const state = loadState();
        return state.chats[patientId] || [];
    }

    function getAllPatients() {
        const state = loadState();
        return Object.values(state.patients);
    }

    function subscribe(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
    }

    if (channel) {
        channel.addEventListener('message', () => {
            notifySubscribers();
        });
    }

    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
            notifySubscribers();
        }
    });

    if (socket) {
        socket.on('connect', () => {
            const current = loadState();
            if (current.currentPatientId) {
                socket.emit('join-room', {
                    roomId: `consult_room_${current.currentPatientId}`,
                    role: 'sync-client'
                });
                socket.emit('sync-state', {
                    roomId: `consult_room_${current.currentPatientId}`,
                    state: current
                });
            }
        });

        socket.on('sync-state', ({ state: remoteState }) => {
            if (!remoteState) return;
            const local = loadState();
            const merged = mergeStates(local, remoteState);
            saveState(merged, true, false);
        });

        socket.on('chat-message', ({ patientId, message }) => {
            if (!patientId || !message) return;
            const local = loadState();
            if (!local.chats[patientId]) local.chats[patientId] = [];
            const key = message.id || `${message.sender}|${message.text}|${message.time}`;
            const exists = local.chats[patientId].some(
                m => (m.id || `${m.sender}|${m.text}|${m.time}`) === key
            );
            if (!exists) {
                local.chats[patientId].push(message);
                saveState(local, true, false);
            }
        });
    }

    return {
        loadState,
        registerPatient,
        getCurrentPatient,
        submitPaymentScreenshot,
        setPaymentStatus,
        sendChatMessage,
        getChats,
        getAllPatients,
        subscribe
    };
})();