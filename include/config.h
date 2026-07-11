#pragma once
/*
 * config.h — Optional: move your user config here to keep main.cpp clean.
 *
 * Usage: In main.cpp, replace the #define block with:
 *     #include "config.h"
 */

// ── WiFi ──────────────────────────────────────────────────────
#define WIFI_SSID         "YOUR_WIFI_SSID"
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"

#define AP_PORTAL_NAME    "DG-SET-CONFIG"

// ── Backend server ────────────────────────────────────────────
// Run `ipconfig` on Windows to find your PC's IPv4 address
// Example: "http://192.168.1.105:3000/api/genset-data"
#define SERVER_URL        "http://YOUR_SERVER_IP:3000/api/genset-data"

// ── Modbus ────────────────────────────────────────────────────
#define MODBUS_SLAVE_ID   1       // PS0600 default slave ID
#define RS485_BAUD_RATE   9600    // PS0600 default baud rate

// ── Pin assignments ───────────────────────────────────────────
#define RS485_RX_PIN      16      // ESP32 RX2 → RS485 RO
#define RS485_TX_PIN      17      // ESP32 TX2 → RS485 DI
#define RS485_DE_RE_PIN    4      // DE+RE tied to this pin

// ── Polling ───────────────────────────────────────────────────
#define POLL_INTERVAL_MS  2000    // 2 seconds between reads