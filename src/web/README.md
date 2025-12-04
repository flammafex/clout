# Scarcity Web Wallet

A clean, functional web interface for the Scarcity privacy-preserving P2P value transfer protocol.

## Features

- **Wallet Management**: Create, import, and manage multiple wallets
- **Token Operations**: Mint, transfer, receive tokens
- **Advanced Operations**: Split and merge tokens
- **Real-time Updates**: Live balance and transaction history
- **Clean UI**: Modern, responsive interface

## Quick Start

### Start the Server

```bash
npm run web
```

The server will start on http://localhost:3000

### Development Mode

```bash
npm run web:dev
```

## Architecture

### Backend (Express API)

The web server (`src/web/server.ts`) provides a REST API that wraps the CLI functionality:

- **Infrastructure**: Initializes Witness, Freebird, HyperToken, and Gossip networks
- **Wallet API**: Complete wallet CRUD operations
- **Token API**: All token operations from Phase 3 (mint, transfer, split, merge)

### Frontend (Vanilla JS)

The frontend (`src/web/public/`) is a single-page application:

- **No framework dependencies**: Pure HTML/CSS/JavaScript
- **Clean UI**: Modern design with responsive layout
- **Tab-based navigation**: Organized workflow
- **Real-time feedback**: Loading states and error handling

## API Endpoints

### Health & Initialization
- `GET /api/health` - Check server status
- `POST /api/init` - Initialize network infrastructure

### Wallets
- `GET /api/wallets` - List all wallets
- `POST /api/wallets` - Create new wallet
- `POST /api/wallets/import` - Import wallet from secret key
- `GET /api/wallets/:name` - Get wallet details
- `DELETE /api/wallets/:name` - Delete wallet
- `POST /api/wallets/:name/default` - Set default wallet
- `GET /api/wallets/:name/export` - Export secret key
- `GET /api/wallets/:name/balance` - Get wallet balance

### Tokens
- `GET /api/tokens` - List all tokens (with filters)
- `POST /api/tokens/mint` - Mint new token
- `POST /api/tokens/transfer` - Transfer token to recipient
- `POST /api/tokens/receive` - Receive token from transfer
- `POST /api/tokens/split` - Split token into multiple tokens
- `POST /api/tokens/merge` - Merge multiple tokens into one

## Usage Flow

1. **Initialize**: Click "Initialize Network" to connect to Scarcity infrastructure
2. **Create Wallet**: Create or import a wallet
3. **Mint Tokens**: Mint initial tokens for testing
4. **Transfer**: Send tokens between wallets
5. **Operations**: Split large tokens or merge small ones

## Configuration

The web wallet uses the same configuration as the CLI:
- Config file: `~/.scarcity/config.json`
- Wallets: `~/.scarcity/wallets.json`
- Tokens: `~/.scarcity/tokens.json`

## Port Configuration

Default port is 3000. To use a different port:

```bash
PORT=8080 npm run web
```

## Security Notes

- **Local Only**: The server runs locally and stores data in your home directory
- **No Authentication**: This is a development tool - don't expose to the internet
- **Secret Keys**: Handle exported secret keys carefully
- **HTTPS**: For production use, add TLS/SSL

## Browser Compatibility

Tested on:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## Troubleshooting

### Server won't start
- Check if port 3000 is available
- Ensure `npm run build` completes successfully

### Network initialization fails
- Verify Witness/Freebird/HyperToken services are accessible
- Check `.scarcity/config.json` for correct endpoints

### Tokens not appearing
- Ensure network is initialized
- Check `~/.scarcity/tokens.json` for stored tokens
- Refresh the page

## Development

### File Structure

```
src/web/
├── server.ts           # Express API server
├── public/
│   ├── index.html     # Main HTML page
│   ├── styles.css     # UI styles
│   └── app.js         # Frontend application logic
└── README.md          # This file
```

### Adding New Features

1. Add API endpoint in `server.ts`
2. Add UI in `index.html`
3. Add styling in `styles.css`
4. Add logic in `app.js`

## Phase 4 Progress

✅ Web Wallet Interface (COMPLETE)
- Full wallet management
- All Phase 3 token operations
- Clean, modern UI
- REST API for integration

## Next Steps

- Add HTLC operations UI
- Add Bridge operations UI
- Add QR code generation for transfers
- Add transaction history export
- Add network statistics dashboard
