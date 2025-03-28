// index.js
import blessed from 'blessed';
import { io } from 'socket.io-client';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import DatabaseManager from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import * as wrtc from 'wrtc';
import RTCPeerConnection from 'wrtc/lib/peerconnection.js';
import RTCSessionDescription from 'wrtc/lib/sessiondescription.js';
import RTCIceCandidate from 'wrtc/lib/icecandidate.js';

// Initialize blessed screen
const screen = blessed.screen({
    smartCSR: true,
    title: 'WebRTC CLI Chat',
    debug: true
});

// Create UI elements
const layout = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%'
});

const helpText = blessed.box({
    parent: layout,
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: '{bold}Controls:{/bold} h/l-switch panels | j/k-navigate | Enter-select | /file to send files | q-quit',
    style: {
        fg: 'white',
        bg: 'blue'
    },
    tags: true
});

const usersList = blessed.list({
    parent: layout,
    left: 0,
    top: 1,
    width: '30%',
    height: '99%',
    border: {
        type: 'line'
    },
    style: {
        selected: {
            bg: 'blue',
            bold: true
        },
        border: {
            fg: 'white'
        }
    },
    keys: true,
    vi: true,
    label: ' Users ',
    tags: true,
    scrollable: true,
    alwaysScroll: true
});

const groupsList = blessed.list({
    parent: layout,
    left: 0,
    top: 1,
    width: '30%',
    height: '49%',
    border: {
        type: 'line'
    },
    style: {
        selected: {
            bg: 'blue',
            bold: true
        },
        border: {
            fg: 'white'
        }
    },
    keys: true,
    vi: true,
    label: ' Groups ',
    tags: true,
    scrollable: true,
    alwaysScroll: true
});

const chatBox = blessed.box({
    parent: layout,
    left: '30%',
    top: 1,
    width: '70%',
    height: '90%',
    border: {
        type: 'line'
    },
    label: ' Chat ',
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    style: {
        border: {
            fg: 'white'
        }
    }
});

const inputBox = blessed.textbox({
    parent: layout,
    left: '30%',
    top: '91%',
    width: '70%',
    height: '9%',
    border: {
        type: 'line'
    },
    input: true,
    inputOnFocus: true,
    keys: true,
    vi: true,
    label: ' Message ',
    style: {
        border: {
            fg: 'white'
        },
        focus: {
            border: {
                fg: 'blue'
            }
        }
    }
});

usersList.top = '50%';
usersList.height = '49%';
usersList.label = ' Private Chats ';

// State management
const connections = new Map();
const chatHistory = new Map();
let currentPeer = null;
let currentPanel = 'users'; // 'users' or 'input'
let fileReceiveState = new Map();

// const socket = io('http://localhost:3000');
const socket = io('http://155.248.250.55:3000');
// const socket = io(`${process.env.SIGNALING_SERVER_URL}`);

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const colorMap = {
        info: 'white',
        error: 'red',
        success: 'green',
        warning: 'yellow'
    };
    const color = colorMap[type] || 'white';

    chatBox.pushLine(`{${color}-fg}[${timestamp}] ${message}{/}`);
    chatBox.setScrollPerc(100);
    screen.render();
}

function updateChatDisplay(peerId) {
    chatBox.setContent('');
    if (chatHistory.has(peerId)) {
        chatHistory.get(peerId).forEach(msg => {
            chatBox.pushLine(msg);
        });
    }
    chatBox.setScrollPerc(100);
    screen.render();
}

function createGroup() {
    const groupNamePrompt = blessed.prompt({
        parent: screen,
        border: 'line',
        height: 'shrink',
        width: 'half',
        top: 'center',
        left: 'center',
        label: ' Create Group ',
        tags: true,
        keys: true,
        vi: true
    });

    groupNamePrompt.input('Enter group name:', '', async (err, groupName) => {
        if (err || !groupName) return;

        // Generate a unique group ID
        const groupId = `group_${Date.now()}`;

        // Create group in database
        await DatabaseManager.createGroup(groupId, groupName);

        // Add current user as first member
        await DatabaseManager.addGroupMember(groupId, socket.id);

        // Update groups list
        updateGroupsList();
    });
}

function updateGroupsList() {
    groupsList.clearItems();

    // Fetch groups from database (you'd need to add this method)
    const groups = [/* Fetch groups */];

    groups.forEach(group => {
        groupsList.addItem(`{blue-fg}●{/} ${group.name}`);
    });

    screen.render();
}



const configuration = {
    iceServers: [{
        urls: `${process.env.TURN_SERVER_URL}`,
        username: `${process.env.TURN_SERVER_USERNAME}`,
        credential: `${process.env.TURN_SERVER_PASSWORD}`
    }]
};


// function addMessageToHistory(peerId, message) {
//   if (!chatHistory.has(peerId)) {
//     chatHistory.set(peerId, []);
//   }
//   chatHistory.get(peerId).push(message);
//   if (currentPeer === peerId) {
//     updateChatDisplay(peerId);
//   }
// }

function addMessageToHistory(peerId, message) {
    if (!chatHistory.has(peerId)) {
        chatHistory.set(peerId, []);
    }
    chatHistory.get(peerId).push(message);

    // Persist message to database
    DatabaseManager.saveMessage(
        socket.id,
        peerId.startsWith('group_') ? 'group' : 'private',
        peerId,
        message.replace(/\{.*?\}/g, '') // Remove formatting
    );

    if (currentPeer === peerId) {
        updateChatDisplay(peerId);
    }
}

async function sendFile(filePath, dataChannel) {
    try {
        const fileBuffer = await fs.readFile(filePath);
        const fileName = path.basename(filePath);
        const fileSize = fileBuffer.length;

        log(`Starting to send file: ${fileName}`, 'info');

        // Send file metadata
        dataChannel.send(JSON.stringify({
            type: 'file-meta',
            name: fileName,
            size: fileSize
        }));

        // Send file in chunks
        const chunkSize = 16384;
        let sent = 0;

        for (let i = 0; i < fileBuffer.length; i += chunkSize) {
            const chunk = fileBuffer.slice(i, i + chunkSize);
            dataChannel.send(chunk);
            sent += chunk.length;

            // Update progress every 10%
            if (Math.floor((sent / fileSize) * 10) > Math.floor(((sent - chunk.length) / fileSize) * 10)) {
                log(`Sending progress: ${Math.floor((sent / fileSize) * 100)}%`, 'info');
            }

            await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
        }

        dataChannel.send(JSON.stringify({ type: 'file-end' }));
        log(`File sent successfully: ${fileName}`, 'success');
    } catch (err) {
        log(`Error sending file: ${err.message}`, 'error');
    }
}

async function handleFileReceive(data, peerId) {
    if (!connections.has(peerId)) return;

    if (!fileReceiveState.has(peerId)) {
        fileReceiveState.set(peerId, { receiving: false });
    }

    const state = fileReceiveState.get(peerId);

    if (typeof data === 'string') {
        try {
            const message = JSON.parse(data);

            if (message.type === 'file-meta') {
                state.receiving = true;
                state.fileName = message.name;
                state.fileSize = message.size;
                state.received = 0;
                state.stream = createWriteStream(path.join(__dirname, 'downloads', message.name));
                log(`Receiving file: ${message.name} (${Math.round(message.size / 1024)} KB)`, 'info');
            }
            else if (message.type === 'file-end' && state.receiving) {
                state.stream.end();
                log(`File received: ${state.fileName}`, 'success');
                state.receiving = false;
                delete state.fileName;
                delete state.fileSize;
                delete state.received;
                delete state.stream;
            }
        } catch (e) {
            // Not a JSON message, treat as regular chat
            if (!state.receiving) {
                addMessageToHistory(peerId, `{cyan-fg}Peer{/}: ${data}`);
            }
        }
    } else if (state.receiving) {
        // Binary data - must be file chunk
        state.stream.write(Buffer.from(data));
        state.received += data.byteLength;

        // Update progress every 10%
        if (Math.floor((state.received / state.fileSize) * 10) >
            Math.floor(((state.received - data.byteLength) / state.fileSize) * 10)) {
            log(`Receiving progress: ${Math.floor((state.received / state.fileSize) * 100)}%`, 'info');
        }
    }
}

function setupDataChannel(channel, peerId) {
    channel.onopen = () => {
        log(`Connected to peer: ${peerId}`, 'success');
        updateUsersList([...connections.keys()]); // Ensure UI updates
    };

    channel.onclose = () => {
        log(`Disconnected from peer: ${peerId}`, 'warning');
        updateUsersList([...connections.keys()]);
    };

    channel.onmessage = (event) => {
        handleFileReceive(event.data, peerId);
    };
}


// function setupDataChannel(channel, peerId) {
//   channel.onopen = () => {
//     log(`Connected to peer: ${peerId}`, 'success');
//     updateUsersList();
//   };

//   channel.onclose = () => {
//     log(`Disconnected from peer: ${peerId}`, 'warning');
//     updateUsersList();
//   };

//   channel.onmessage = (event) => {
//     handleFileReceive(event.data, peerId);
//   };
// }

// function updateUsersList() {
//   const users = Array.from(socket._callbacks['$users-update'][0].arguments[0]);
//   usersList.clearItems();
//   users
//     .filter(id => id !== socket.id)
//     .forEach(id => {
//       const conn = connections.get(id);
//       const status = conn?.dataChannel?.readyState === 'open' ? '{green-fg}●{/}' : '{red-fg}○{/}';
//       usersList.addItem(`${status} ${id}${id === currentPeer ? ' {blue-fg}[SELECTED]{/}' : ''}`);
//     });
//   screen.render();
// }

function updateUsersList(users = []) {
    usersList.clearItems();
    users
        .filter(id => id !== socket.id)
        .forEach(id => {
            const conn = connections.get(id);
            const status = conn?.dataChannel?.readyState === 'open' ? '{green-fg}●{/}' : '{red-fg}○{/}';
            usersList.addItem(`${status} ${id}${id === currentPeer ? ' {blue-fg}[SELECTED]{/}' : ''}`);
        });
    screen.render();

}

async function createNewPeerConnection(userId) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            {
                urls: "turn:relay1.expressturn.com:3478",
                username: "efL6P4932MPCZWWEST",
                credential: "RRVxBMauicb6pO4k"
            }
        ]
    });

    return new Promise((resolve, reject) => {
        // Create data channel before offer
        const dataChannel = peerConnection.createDataChannel('chat', {
            negotiated: false,
            ordered: true
        });

        // Setup error handlers
        peerConnection.onerror = (error) => {
            log(`Peer connection error: ${error}`, 'error');
            reject(error);
        };

        peerConnection.oniceconnectionstatechange = () => {
            log(`ICE Connection State: ${peerConnection.iceConnectionState}`, 'info');

            if (peerConnection.iceConnectionState === 'failed') {
                log('ICE Connection Failed', 'error');
                reject(new Error('ICE Connection Failed'));
            }
        };

        dataChannel.onopen = () => {
            log(`Data channel opened for ${userId}`, 'success');
        };

        dataChannel.onerror = (error) => {
            log(`Data channel error: ${error}`, 'error');
            reject(error);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', event.candidate, userId);
            }
        };

        resolve({ peerConnection, dataChannel });
    });
}



// async function connectToPeer(userId) {
//   if (userId === currentPeer) return;

//   currentPeer = userId;
//   updateChatDisplay(userId);
//   // updateUsersList(userId);

//   if (connections.has(userId)) {
//     const conn = connections.get(userId);
//     if (conn.dataChannel.readyState === 'open') return;
//   }

//   log(`Initiating connection to: ${userId}`, 'info');

//   const peerConnection = new RTCPeerConnection(configuration);
//   const dataChannel = peerConnection.createDataChannel('chat');

//   setupDataChannel(dataChannel, userId);

//   connections.set(userId, {
//     peerConnection,
//     dataChannel
//   });

//   peerConnection.onicecandidate = (event) => {
//     if (event.candidate) {
//       socket.emit('ice-candidate', event.candidate, userId);
//     }
//   };

//   try {
//     const offer = await peerConnection.createOffer();
//     await peerConnection.setLocalDescription(offer);
//     socket.emit('offer', offer, userId);
//   } catch (err) {
//     log(`Error creating offer: ${err.message}`, 'error');
//   }
// }

async function connectToPeer(userId) {
    if (userId === currentPeer) return;

    currentPeer = userId;
    updateChatDisplay(userId);

    // Remove any existing connection
    if (connections.has(userId)) {
        const existingConn = connections.get(userId);
        try {
            existingConn.dataChannel?.close();
            existingConn.peerConnection?.close();
        } catch (err) {
            log(`Error closing existing connection: ${err.message}`, 'warning');
        }
        connections.delete(userId);
    }

    try {
        log(`Initiating connection to: ${userId}`, 'info');

        // Create new peer connection
        const { peerConnection, dataChannel } = await createNewPeerConnection(userId);

        // Setup data channel
        setupDataChannel(dataChannel, userId);

        // Store connection
        connections.set(userId, {
            peerConnection,
            dataChannel
        });

        // Create and send offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', offer, userId);

    } catch (err) {
        log(`Connection error: ${err.message}`, 'error');
        connections.delete(userId);
        currentPeer = null;
    }
}

// Socket event handlers
// socket.on('users-update', updateUsersList);
socket.on('users-update', (users) => updateUsersList(users));

// socket.on('offer', async (offer, fromId) => {
//   if (!connections.has(fromId)) {
//     log(`Received connection offer from: ${fromId}`, 'info');

//     const peerConnection = new RTCPeerConnection(configuration);

//     peerConnection.ondatachannel = (event) => {
//       const dataChannel = event.channel;
//       setupDataChannel(dataChannel, fromId);
//       connections.set(fromId, { peerConnection, dataChannel });
//     };

//     peerConnection.onicecandidate = (event) => {
//       if (event.candidate) {
//         socket.emit('ice-candidate', event.candidate, fromId);
//       }
//     };

//     try {
//       await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
//       const answer = await peerConnection.createAnswer();
//       await peerConnection.setLocalDescription(answer);
//       socket.emit('answer', answer, fromId);
//     } catch (err) {
//       log(`Error handling offer: ${err.message}`, 'error');
//     }
//   }
// });

// On application startup
async function initializeApp() {
    // Initialize database
    await DatabaseManager.init();

    // Check for unread messages
    const unreadMessages = await DatabaseManager.getUnreadMessages(socket.id);

    unreadMessages.forEach(msg => {
        // Display unread messages
        if (msg.recipient_type === 'private') {
            addMessageToHistory(msg.sender_id, `{cyan-fg}${msg.sender_id}{/}: ${msg.message}`);
        } else if (msg.recipient_type === 'group') {
            addMessageToHistory(msg.recipient_id, `{cyan-fg}${msg.sender_id}{/}: ${msg.message}`);
        }
    });

    // Mark messages as read
    await DatabaseManager.markMessagesAsRead(socket.id);
}



socket.on('offer', async (offer, fromId) => {
    try {
        // Close existing connection if it exists
        if (connections.has(fromId)) {
            const existingConn = connections.get(fromId);
            try {
                existingConn.dataChannel?.close();
                existingConn.peerConnection?.close();
            } catch (err) {
                log(`Error closing existing connection: ${err.message}`, 'warning');
            }
            connections.delete(fromId);
        }

        log(`Received connection offer from: ${fromId}`, 'info');

        const peerConnection = new RTCPeerConnection({
            iceServers: [
                {
                    urls: "turn:relay1.expressturn.com:3478",
                    username: "efL6P4932MPCZWWEST",
                    credential: "RRVxBMauicb6pO4k"
                }
            ]
        });

        return new Promise((resolve, reject) => {
            peerConnection.ondatachannel = (event) => {
                const dataChannel = event.channel;
                setupDataChannel(dataChannel, fromId);

                connections.set(fromId, {
                    peerConnection,
                    dataChannel
                });
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', event.candidate, fromId);
                }
            };

            peerConnection.oniceconnectionstatechange = () => {
                log(`ICE Connection State for ${fromId}: ${peerConnection.iceConnectionState}`, 'info');

                if (peerConnection.iceConnectionState === 'failed') {
                    log('ICE Connection Failed', 'error');
                    connections.delete(fromId);
                    reject(new Error('ICE Connection Failed'));
                }
            };

            peerConnection.onerror = (error) => {
                log(`Peer connection error: ${error}`, 'error');
                connections.delete(fromId);
                reject(error);
            };

            // Set remote description and create answer
            peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
                .then(() => peerConnection.createAnswer())
                .then(answer => peerConnection.setLocalDescription(answer))
                .then(() => {
                    socket.emit('answer', peerConnection.localDescription, fromId);
                    resolve();
                })
                .catch(err => {
                    log(`Error handling offer: ${err.message}`, 'error');
                    connections.delete(fromId);
                    reject(err);
                });
        });

    } catch (err) {
        log(`Offer processing error: ${err.message}`, 'error');
    }
});

// socket.on('offer', async (offer, fromId) => {
//   if (!connections.has(fromId)) {
//     log(`Received connection offer from: ${fromId}`, 'info');

//     const peerConnection = new RTCPeerConnection(configuration);

//     peerConnection.ondatachannel = (event) => {
//       setupDataChannel(event.channel, fromId);
//       connections.set(fromId, {
//         peerConnection,
//         dataChannel: event.channel
//       });
//     };

//     peerConnection.onicecandidate = (event) => {
//       if (event.candidate) {
//         socket.emit('ice-candidate', event.candidate, fromId);
//       }
//     };

//     try {
//       await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
//       const answer = await peerConnection.createAnswer();
//       await peerConnection.setLocalDescription(answer);
//       socket.emit('answer', answer, fromId);
//     } catch (err) {
//       log(`Error handling offer: ${err.message}`, 'error');
//     }
//   }
// });

// socket.on('answer', async (answer, fromId) => {
//   const conn = connections.get(fromId);
//   if (conn) {
//     try {
//       await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
//     } catch (err) {
//       log(`Error setting remote description: ${err.message}`, 'error');
//     }
//   }
// });

socket.on('answer', async (answer, fromId) => {
    const conn = connections.get(fromId);
    if (conn && conn.peerConnection) {
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
            log(`Error setting remote description: ${err.message}`, 'error');
            connections.delete(fromId);
        }
    }
});

socket.on('group-message', async (data) => {
    const { groupId, senderId, message } = data;

    // Save message to database
    await DatabaseManager.saveMessage(
        senderId,
        'group',
        groupId,
        message
    );

    // Update chat display if this is the current group
    if (currentPeer === groupId) {
        addMessageToHistory(groupId, `{cyan-fg}${senderId}{/}: ${message}`);
    }
});

socket.on('ice-candidate', async (candidate, fromId) => {
    const conn = connections.get(fromId);
    if (conn?.peerConnection) {
        try {
            if (conn.peerConnection.remoteDescription) {
                await conn.peerConnection.addIceCandidate(new RTCIceCandidate({
                    candidate: candidate.candidate,
                    sdpMid: candidate.sdpMid,
                    sdpMLineIndex: candidate.sdpMLineIndex
                }));
            }
        } catch (err) {
            log(`Error adding ICE candidate: ${err.message}`, 'error');
        }
    }
});

// Input handling
inputBox.on('submit', async (text) => {
    if (!text) return;

    if (text.startsWith('/create-group')) {
        createGroup();
        return;
    }

    if (text.startsWith('/invite ')) {
        const userId = text.slice(8).trim();
        if (currentPeer && currentPeer.startsWith('group_')) {
            await DatabaseManager.addGroupMember(currentPeer, userId);
            socket.emit('group-invite', {
                groupId: currentPeer,
                userId
            });
        }
        return;
    }

    if (text.startsWith('/file ')) {
        const filePath = text.slice(6).trim();
        const conn = connections.get(currentPeer);
        if (conn && conn.dataChannel.readyState === 'open') {
            sendFile(filePath, conn.dataChannel);
        } else {
            log('No active connection to send file', 'error');
        }
    } else {
        const conn = connections.get(currentPeer);
        if (conn && conn.dataChannel.readyState === 'open') {

            if (currentPeer.startsWith('group_')) {
                // Group message
                socket.emit('group-message', {
                    groupId: currentPeer,
                    senderId: socket.id,
                    message: text
                });
                addMessageToHistory(currentPeer, `{green-fg}You{/}: ${text}`);
            } else {
                // Private message
                conn.dataChannel.send(text);
                addMessageToHistory(currentPeer, `{green-fg}You{/}: ${text}`);
            }
        } else {
            log('No active connection to send message', 'error');
        }
    }

    inputBox.clearValue();
    inputBox.focus();
    screen.render();
});


// Navigation
function switchPanel(panel) {
    currentPanel = panel;
    if (panel === 'users') {
        usersList.focus();
    } else {
        inputBox.focus();
    }
    screen.render();
}

// Key bindings
screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

screen.key(['h'], () => switchPanel('users'));
screen.key(['l'], () => switchPanel('input'));

usersList.key(['j'], () => {
    usersList.down();
    screen.render();
});

usersList.key(['k'], () => {
    usersList.up();
    screen.render();
});

// Select user on Enter
usersList.on('select', (item) => {
    const userId = item.content.split(' ')[1];
    connectToPeer(userId);
    switchPanel('input');
});

// Create downloads directory
await fs.mkdir(path.join(__dirname, 'downloads'), { recursive: true });

// Focus users list by default
switchPanel('users');

// Render the screen
screen.render();
initializeApp();
