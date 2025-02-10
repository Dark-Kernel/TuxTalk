# TuxTalk

TuxTalk is a WebRTC-based CLI chat application for peer-to-peer communication. Built with Node.js and Blessed for a terminal-based UI, it allows users to connect and chat directly over WebRTC using TURN server, supporting text messaging and file transfers for now.

## Features

- **Peer-to-Peer Messaging**: Secure direct communication using WebRTC and TURN server.
- **Terminal-based UI**: Uses `blessed` for an intuitive chat interface.
- **File Transfer**: Send and receive files between peers.
- **User List Display**: Shows available peers and connection statuses.
- **Keyboard Shortcuts**:
  - `h/l`: Switch panels (Users/Input)
  - `j/k`: Navigate user list
  - `Enter`: Select user
  - `/file <path>`: Send file
  - `q`: Quit

## Installation

### Prerequisites
- Node.js (v16+ recommended)
- npm or pnpm or yarn

### Dependencies
- A TURN server

Add the TURN server URL to the `.env` file.

### Setup
```sh
# Clone the repository
git clone https://github.com/Dark-Kernel/TuxTalk.git
cd TuxTalk

# Install dependencies
pnpm install

# Run TuxTalk instance
node --env-file=.env index.js
```

## Usage

1. Launch multiple instances of `index.js`.
2. Select a peer from the user list and start chatting.
3. Send messages directly or transfer files using `/file <path>`.

## How It Works

TuxTalk establishes peer-to-peer connections using WebRTC with a central signaling server (TURN) for initial handshake:
1. Users connect to the signaling server via Socket.io.
2. When a user selects another peer, an offer is sent to initiate a WebRTC connection.
3. Once the connection is established, messages and files are exchanged peer-to-peer, with the option of using a TURN server to relay the connection if direct peer-to-peer is not possible.

## TODO
- Implement NAT traversal improvements
- Add encryption for enhanced security
- Improve file transfer UI feedback

