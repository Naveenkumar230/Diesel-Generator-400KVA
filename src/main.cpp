#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <ModbusMaster.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

// ════════════════════════════════════════════════════════════════
//  USER CONFIGURATION
// ════════════════════════════════════════════════════════════════
#define WIFI_SSID        "AIPL-IOT"
#define WIFI_PASSWORD    "@ipl2026"

#define MQTT_BROKER      "a0d0d0e9332a4d3db7516f6125f6e677.s1.eu.hivemq.cloud"
#define MQTT_PORT        8883
#define MQTT_USER        "TemperatureSensor"
#define MQTT_PASS        "Naveen235623@@"
#define MQTT_CLIENT_ID   "gensight-esp32"
#define MQTT_TOPIC_DATA  "gensight/genset/data"
#define MQTT_TOPIC_CMD   "gensight/genset/cmd"

// FIX #6 — was 2000, Modbus scan takes ~1s so 2s left no breathing room
#define POLL_INTERVAL_MS  5000

// Change these two lines:
#define RS485_RX_PIN      16  //Ro
#define RS485_TX_PIN      17   //DI
#define RS485_DE_RE_PIN    4   //RE
#define WIFI_LED_PIN      26   //Wifi
#define RS485_BAUD_RATE   9600
#define MODBUS_SLAVE_ID    1

// ════════════════════════════════════════════════════════════════
//  PS0600 MODBUS REGISTER MAP  (TABLE 49, A029X159 Issue 29)
//  FC03 address = Document Address - 400001
// ════════════════════════════════════

static const uint16_t REG_DEVICE_TYPE      =   8;  // 400009
static const uint16_t REG_SWITCH_POSITION  =   9;  // 400010
static const uint16_t REG_GENSET_STATE     =  10;  // 400011
static const uint16_t REG_FAULT_CODE       =  11;  // 400012
static const uint16_t REG_FAULT_SEVERITY   =  12;  // 400013
static const uint16_t REG_NFPA110_H        =  15;  // 400016 (32-bit)`

static const uint16_t REG_VOLT_L1N         =  17;  // 400018
static const uint16_t REG_VOLT_L2N         =  18;  // 400019
static const uint16_t REG_VOLT_L3N         =  19;  // 400020
static const uint16_t REG_VOLT_L1L2        =  21;  // 400022
static const uint16_t REG_VOLT_L2L3        =  22;  // 400023
static const uint16_t REG_VOLT_L3L1        =  23;  // 400024

static const uint16_t REG_CURR_L1          =  25;  // 400026
static const uint16_t REG_CURR_L2          =  26;  // 400027
static const uint16_t REG_CURR_L3          =  27;  // 400028

static const uint16_t REG_KW_L1            =  30;  // 400031 signed
static const uint16_t REG_KW_L2            =  31;  // 400032 signed
static const uint16_t REG_KW_L3            =  32;  // 400033 signed
static const uint16_t REG_KW_TOTAL         =  33;  // 400034 signed

static const uint16_t REG_KVAR_L1          =  34;  // 400035 signed
static const uint16_t REG_KVAR_L2          =  35;  // 400036 signed
static const uint16_t REG_KVAR_L3          =  36;  // 400037 signed
static const uint16_t REG_KVAR_TOTAL       =  37;  // 400038 signed

static const uint16_t REG_KVA_L1           =  39;  // 400040
static const uint16_t REG_KVA_L2           =  40;  // 400041
static const uint16_t REG_KVA_L3           =  41;  // 400042
static const uint16_t REG_KVA_TOTAL        =  42;  // 400043

static const uint16_t REG_FREQUENCY        =  43;  // 400044 ×0.01 Hz

static const uint16_t REG_CURR_PCT_L1      =  57;  // 400058 ×0.1 %
static const uint16_t REG_CURR_PCT_L2      =  58;  // 400059
static const uint16_t REG_CURR_PCT_L3      =  59;  // 400060

static const uint16_t REG_BATT_VOLTAGE     =  60;  // 400061 ×0.001 V
static const uint16_t REG_OIL_PRESSURE     =  61;  // 400062 ×0.1 psi
static const uint16_t REG_OIL_TEMP         =  62;  // 400063 ×0.1 °F signed
static const uint16_t REG_COOLANT_TEMP     =  63;  // 400064 ×0.1 °F signed
static const uint16_t REG_INTAKE_TEMP      =  64;  // 400065 ×0.1 °F signed
static const uint16_t REG_FUEL_TEMP        =  65;  // 400066 ×0.1 °F signed
static const uint16_t REG_ENGINE_RPM       =  67;  // 400068 ×0.125 RPM

static const uint16_t REG_START_ATTEMPTS   =  68;  // 400069
static const uint16_t REG_ENGINE_HRS_H     =  69;  // 400070 32-bit ×0.05 hours

static const uint16_t REG_UTIL_VOLT_L1N    = 117;  // 400118
static const uint16_t REG_UTIL_VOLT_L2N    = 118;  // 400119
static const uint16_t REG_UTIL_VOLT_L3N    = 119;  // 400120
static const uint16_t REG_UTIL_VOLT_L1L2   = 121;  // 400122
static const uint16_t REG_UTIL_VOLT_L2L3   = 122;  // 400123
static const uint16_t REG_UTIL_VOLT_L3L1   = 123;  // 400124
static const uint16_t REG_UTIL_FREQ_H      = 143;  // 400144 32-bit ×0.001 Hz

static const uint16_t REG_CUST_INPUT5      = 145;  // 400146
static const uint16_t REG_CUST_INPUT6      = 146;  // 400147
static const uint16_t REG_CUST_INPUT4      = 156;  // 400157

static const uint16_t REG_CHARGE_ALT_V     = 206;  // 400207 ×0.001 V
static const uint16_t REG_AMBER_WARN       = 227;  // 400228
static const uint16_t REG_BOOST_PRESSURE   = 229;  // 400230 ×0.1 psi
static const uint16_t REG_CAN_STATUS       = 230;  // 400231
static const uint16_t REG_CRANKCASE_PRESS  = 231;  // 400232 ×0.1 psi signed

static const uint16_t REG_PGI_MAJOR        = 237;  // 400238
static const uint16_t REG_PGI_MINOR        = 238;  // 400239
static const uint16_t REG_PGI_INFO         = 239;  // 400240

static const uint16_t REG_FUEL_SUPPLY_PR   = 253;  // 400254 ×0.1 psi
static const uint16_t REG_FUEL_RAIL_PR_H   = 257;  // 400258 32-bit ×0.1 psi

static const uint16_t REG_ENGINE_TORQUE    = 263;  // 400264 signed

static const uint16_t REG_REMOTE_START     = 299;  // 400300 R/W
static const uint16_t REG_FAULT_RESET      = 300;  // 400301 R/W

static const uint16_t REG_FUEL_SHUTOFF     = 542;  // 400543
static const uint16_t REG_STARTER_OUT      = 556;  // 400557
static const uint16_t REG_EXHAUST_TEMP     = 584;  // 400585 ×0.1 °F signed

static const uint16_t REG_SHUT_FAULT_1     = 1001; // 401002 (10 rows)
static const uint16_t REG_WARN_FAULT_1     = 1011; // 401012 (10 rows)

static const uint16_t REG_AMF_STATE        = 1023; // 401024
static const uint16_t REG_XFER_SW_STATUS   = 1024; // 401025

static const uint16_t REG_MODEL_NUM        = 3032; // 403033 (10 regs, 20 chars)
static const uint16_t REG_SERIAL_NUM       = 3048; // 403049 (10 regs, 20 chars)

static const uint16_t REG_FUEL_LEVEL_PCT   = 3744; // 403745
static const uint16_t REG_FUEL_LEVEL_L     = 3745; // 403746

static const uint16_t REG_LOW_BATT_THRESH  = 3510; // 403511 ×0.1 V
static const uint16_t REG_HIGH_BATT_THRESH = 3675; // 403676 ×0.1 V

static const uint16_t REG_SCHEDULER_STATE  = 3777; // 403778

static const uint16_t REG_CUST_INPUT1      = 3792; // 403793
static const uint16_t REG_CUST_INPUT2      = 3598; // 403599
static const uint16_t REG_CUST_INPUT3      = 3561; // 403562

static const uint16_t REG_ENGINE_OP_STATE  = 6108; // 406109
static const uint16_t REG_COOLANT_PRESS    = 6123; // 406124 ×0.1 psi signed

// ════════════════════════════════════════════════════════════════
//  DECODER FUNCTIONS
// ════════════════════════════════════════════════════════════════

static const char* decodeGensetState(uint16_t code) {
    switch (code) {
        case  0: return "OFF";
        case  1: return "STOP";
        case  2: return "PREHEAT";
        case  3: return "PRECRANK";
        case  4: return "CRANK";
        case  5: return "STARTER DISCONNECT";
        case  6: return "PRE-RAMP";
        case  7: return "RAMP";
        case  8: return "RUNNING";
        case  9: return "FAULT SHUTDOWN";
        case 10: return "PRERUN SETUP";
        case 11: return "RUNTIME SETUP";
        case 12: return "FACTORY TEST";
        case 13: return "WAITING FOR POWERDOWN";
        default: return "UNKNOWN";
    }
}

static const char* decodeEngineOpState(uint16_t code) {
    switch (code) {
        case  0: return "Engine Stopped";
        case  1: return "Prestart";
        case  2: return "Starting";
        case  3: return "Warmup";
        case  4: return "Running";
        case  5: return "Cooldown";
        case  6: return "Engine Stopping";
        case  7: return "Post Run";
        case  8: return "Out of Range";
        case  9: return "N/A";
        case 10: return "Network Failure";
        default: return "Unknown";
    }
}

static const char* decodeCanStatus(uint16_t code) {
    switch (code) {
        case 0: return "Inactive";
        case 1: return "Active";
        case 2: return "Failed";
        default: return "Unknown";
    }
}

static const char* decodeAmfState(uint16_t code) {
    switch (code) {
        case  0: return "AMF Not Available";
        case  1: return "Transfer Retransfer Off";
        case  2: return "Utility Pickup";
        case  3: return "Utility Dropout";
        case  4: return "Genset Starting";
        case  5: return "Transfer Start";
        case  6: return "Utility CB Opened";
        case  7: return "Genset CB Closed";
        case  8: return "Transfer Complete";
        case  9: return "Retransfer Start";
        case 10: return "Genset CB Opened";
        case 11: return "Utility CB Closed";
        case 12: return "Retransfer Complete";
        case 13: return "Transfer Fail";
        case 14: return "Retransfer Fail";
        default: return "Unknown";
    }
}

static const char* decodeXferSwitch(uint16_t code) {
    switch (code) {
        case 0: return "Not Available";
        case 1: return "At Utility";
        case 2: return "At Genset";
        case 3: return "Unknown Open";
        case 4: return "Unknown Closed";
        default: return "Unknown";
    }
}

// ════════════════════════════════════════════════════════════════
//  DATA STRUCTURE
// ════════════════════════════════════════════════════════════════
struct GensetData {
    uint16_t deviceType;
    char     modelNumber[22];
    char     serialNumber[22];

    uint16_t switchPosition;
    uint16_t gensetState;
    uint16_t faultCode;
    uint16_t faultSeverity;
    uint32_t nfpa110;
    uint16_t amberWarnLamp;
    uint16_t amfState;
    uint16_t xferSwStatus;
    uint16_t schedulerState;

    float voltL1N, voltL2N, voltL3N;
    float voltL1L2, voltL2L3, voltL3L1;
    float currL1, currL2, currL3;
    float currPctL1, currPctL2, currPctL3;
    float kwL1, kwL2, kwL3, kwTotal;
    float kvarL1, kvarL2, kvarL3, kvarTotal;
    float kvaL1, kvaL2, kvaL3, kvaTotal;
    float frequency;

    float utilVoltL1N, utilVoltL2N, utilVoltL3N;
    float utilVoltL1L2, utilVoltL2L3, utilVoltL3L1;
    float utilFrequency;

    float    battVoltage;
    float    chargeAltVoltage;
    float    lowBattThreshold;
    float    highBattThreshold;
    uint16_t canStatus;

    float    oilPressure;
    float    oilTemp;
    float    coolantTemp;
    float    coolantPressure;
    float    intakeTemp;
    float    fuelTemp;
    float    exhaustTemp;
    float    engineRPM;
    int16_t  engineTorquePct;

    float boostPressure;
    float crankcasePressure;
    float fuelSupplyPressure;
    float fuelRailPressure;

    uint16_t fuelShutoffStatus;
    uint16_t starterStatus;

    uint16_t custInput1;
    uint16_t custInput2;
    uint16_t custInput3;
    uint16_t custInput4;
    uint16_t custInput5;
    uint16_t custInput6;

    uint32_t engineHoursRaw;
    float    engineHoursF;
    uint16_t startAttempts;

    uint16_t fuelLevelPct;
    uint16_t fuelLevelL;

    uint16_t engineOpState;

    uint8_t  pgiMajor;
    uint8_t  pgiMinor;
    uint8_t  pgiInfo;

    uint16_t shutdownFaults[10];
    uint16_t warningFaults[10];

    bool valid;
};

// ════════════════════════════════════════════════════════════════
//  GLOBALS
// ════════════════════════════════════════════════════════════════
ModbusMaster     modbus;
HardwareSerial   modbusSerial(2);
GensetData       gData;
unsigned long    lastPollMs    = 0;
unsigned long    lastWifiRetry = 0;
unsigned long    lastMqttRetry = 0;

WiFiClientSecure wifiSecure;
PubSubClient     mqttClient(wifiSecure);

// ════════════════════════════════════════════════════════════════
//  RS485 DIRECTION CONTROL
// ════════════════════════════════════════════════════════════════
void IRAM_ATTR preTransmission()  { digitalWrite(RS485_DE_RE_PIN, HIGH); }
void IRAM_ATTR postTransmission() { digitalWrite(RS485_DE_RE_PIN, LOW);  }

// ════════════════════════════════════════════════════════════════
//  MODBUS READ HELPERS
// ════════════════════════════════════════════════════════════════

// Reads one register — prints error on fail
bool readReg16(uint16_t addr, uint16_t &out) {
    uint8_t status = modbus.readHoldingRegisters(addr, 1);
    if (status == ModbusMaster::ku8MBSuccess) {
        out = modbus.getResponseBuffer(0);
        return true;
    }
    Serial.printf("[MB] FAIL addr=%u (0x%04X) status=0x%02X\n", addr, addr, status);
    return false;
}

// Reads two registers as 32-bit — prints error on fail
bool readReg32(uint16_t addrHigh, uint32_t &out) {
    uint8_t status = modbus.readHoldingRegisters(addrHigh, 2);
    if (status == ModbusMaster::ku8MBSuccess) {
        out = ((uint32_t)modbus.getResponseBuffer(0) << 16)
              | (uint32_t)modbus.getResponseBuffer(1);
        return true;
    }
    Serial.printf("[MB] FAIL addr32=%u (0x%04X) status=0x%02X\n", addrHigh, addrHigh, status);
    return false;
}

// Reads a block of consecutive registers
bool readBlock(uint16_t startAddr, uint8_t count, uint16_t* buf) {
    uint8_t status = modbus.readHoldingRegisters(startAddr, count);
    if (status == ModbusMaster::ku8MBSuccess) {
        for (uint8_t i = 0; i < count; i++)
            buf[i] = modbus.getResponseBuffer(i);
        return true;
    }
    Serial.printf("[MB] BLOCK FAIL addr=%u count=%u status=0x%02X\n", startAddr, count, status);
    return false;
}

// Silent versions — no error print (for optional/ECM registers)
bool readReg16Silent(uint16_t addr, uint16_t &out) {
    uint8_t status = modbus.readHoldingRegisters(addr, 1);
    if (status == ModbusMaster::ku8MBSuccess) {
        out = modbus.getResponseBuffer(0);
        return true;
    }
    return false;
}

bool readReg32Silent(uint16_t addrHigh, uint32_t &out) {
    uint8_t status = modbus.readHoldingRegisters(addrHigh, 2);
    if (status == ModbusMaster::ku8MBSuccess) {
        out = ((uint32_t)modbus.getResponseBuffer(0) << 16)
              | (uint32_t)modbus.getResponseBuffer(1);
        return true;
    }
    return false;
}

// Reads 20-char ASCII string (10 registers, 2 chars each)
bool readStringReg(uint16_t startAddr, char* outBuf, uint8_t maxLen) {
    uint16_t buf[10];
    if (!readBlock(startAddr, 10, buf)) {
        outBuf[0] = '\0';
        return false;
    }
    uint8_t pos = 0;
    for (uint8_t i = 0; i < 10 && pos < maxLen - 1; i++) {
        char hi = (char)(buf[i] >> 8);
        char lo = (char)(buf[i] & 0xFF);
        if (hi) outBuf[pos++] = hi;
        if (lo) outBuf[pos++] = lo;
    }
    outBuf[pos] = '\0';
    return true;
}

// ════════════════════════════════════════════════════════════════
//  POLL ALL MODBUS REGISTERS
// ════════════════════════════════════════════════════════════════
void pollModbus() {
    uint16_t r16 = 0;
    uint32_t r32 = 0;
    uint16_t blk[10];
    gData.valid = false;

    readReg16Silent(REG_DEVICE_TYPE, r16);
    gData.deviceType = r16;

    if (readReg16(REG_SWITCH_POSITION, r16)) gData.switchPosition = r16;
    if (readReg16(REG_GENSET_STATE,    r16)) gData.gensetState    = r16;
    if (readReg16(REG_FAULT_CODE,      r16)) gData.faultCode      = r16;
    if (readReg16(REG_FAULT_SEVERITY,  r16)) gData.faultSeverity  = r16;
    if (readReg32(REG_NFPA110_H,       r32)) gData.nfpa110        = r32;
    if (readReg16(REG_AMBER_WARN,      r16)) gData.amberWarnLamp  = r16;
    if (readReg16Silent(REG_PGI_INFO,  r16)) gData.pgiInfo        = (uint8_t)(r16 & 0xFF);

    // Genset AC voltages L-N
    // Read voltages 17-23 in one block
    // Volt L-N: 400018,400019,400020 — FC03 addr 17,18,19
    uint16_t vnBlk[3];
    if (readBlock(17, 3, vnBlk)) {
        gData.voltL1N = (float)vnBlk[0];  // 400018
        gData.voltL2N = (float)vnBlk[1];  // 400019
        gData.voltL3N = (float)vnBlk[2];  // 400020
    }
    // Volt L-L: 400022,400023,400024 — FC03 addr 21,22,23
    uint16_t vllBlk[3];
    if (readBlock(21, 3, vllBlk)) {
        gData.voltL1L2 = (float)vllBlk[0];  // 400022
        gData.voltL2L3 = (float)vllBlk[1];  // 400023
        gData.voltL3L1 = (float)vllBlk[2];  // 400024
    }

    // Genset currents
  // Read registers 25-43 in one block (currents, kW, kVAR, kVA, frequency)
   // Currents: 400026,400027,400028 — FC03 addr 25,26,27
    uint16_t currBlk[3];
    if (readBlock(25, 3, currBlk)) {
        gData.currL1 = (float)currBlk[0];  // 400026
        gData.currL2 = (float)currBlk[1];  // 400027
        gData.currL3 = (float)currBlk[2];  // 400028
    }

    // kW + kVAR: 400031→400038 — start FC03 addr 30, read 9
    // reg 30 (400031) does not exist, so index 0 is padding
    uint16_t kwBlk[9];
    if (readBlock(30, 9, kwBlk)) {
        gData.kwL1      = (float)(int16_t)kwBlk[1];  // 400031
        gData.kwL2      = (float)(int16_t)kwBlk[2];  // 400032
        gData.kwL3      = (float)(int16_t)kwBlk[3];  // 400033
        gData.kwTotal   = (float)(int16_t)kwBlk[4];  // 400034
        gData.kvarL1    = (float)(int16_t)kwBlk[5];  // 400035
        gData.kvarL2    = (float)(int16_t)kwBlk[6];  // 400036
        gData.kvarL3    = (float)(int16_t)kwBlk[7];  // 400037
        gData.kvarTotal = (float)(int16_t)kwBlk[8];  // 400038
    }

    // kVA: 400040→400043 — start FC03 addr 39, read 5
    // reg 39 (400040) does not exist, index 0 is padding
    uint16_t kvaBlk[5];
    if (readBlock(39, 5, kvaBlk)) {
        gData.kvaL1    = (float)kvaBlk[1];  // 400040
        gData.kvaL2    = (float)kvaBlk[2];  // 400041
        gData.kvaL3    = (float)kvaBlk[3];  // 400042
        gData.kvaTotal = (float)kvaBlk[4];  // 400043
    }

    // Frequency: 400044 — FC03 addr 43
    if (readReg16(REG_FREQUENCY, r16)) gData.frequency = r16 * 0.01f;

    // Current % ×0.1
    if (readReg16(REG_CURR_PCT_L1, r16)) gData.currPctL1 = r16 * 0.1f;
    if (readReg16(REG_CURR_PCT_L2, r16)) gData.currPctL2 = r16 * 0.1f;
    if (readReg16(REG_CURR_PCT_L3, r16)) gData.currPctL3 = r16 * 0.1f;

    // Battery ×0.001 V
    if (readReg16(REG_BATT_VOLTAGE, r16)) gData.battVoltage = r16 * 0.001f;

    // Oil pressure ×0.1 psi
    if (readReg16(REG_OIL_PRESSURE, r16)) gData.oilPressure = r16 * 0.1f;

    // Temperatures ×0.1 °F signed
    if (readReg16(REG_OIL_TEMP,     r16)) gData.oilTemp     = (int16_t)r16 * 0.1f;
    if (readReg16(REG_COOLANT_TEMP, r16)) gData.coolantTemp = (int16_t)r16 * 0.1f;
    if (readReg16(REG_INTAKE_TEMP,  r16)) gData.intakeTemp  = (int16_t)r16 * 0.1f;
    if (readReg16(REG_FUEL_TEMP,    r16)) gData.fuelTemp    = (int16_t)r16 * 0.1f;
    if (readReg16Silent(REG_EXHAUST_TEMP, r16) && (int16_t)r16 != 0x7FFF)
    gData.exhaustTemp = (int16_t)r16 * 0.1f;
else
    gData.exhaustTemp = 0.0f;

    // RPM ×0.125
    if (readReg16(REG_ENGINE_RPM, r16)) gData.engineRPM = r16 * 0.125f;

    // Torque % signed
    if (readReg16(REG_ENGINE_TORQUE, r16)) gData.engineTorquePct = (int16_t)r16;

    // Pressures
    if (readReg16(REG_BOOST_PRESSURE,  r16)) gData.boostPressure      = r16 * 0.1f;
    if (readReg16(REG_CRANKCASE_PRESS, r16)) gData.crankcasePressure  = (int16_t)r16 * 0.1f;
    if (readReg16(REG_FUEL_SUPPLY_PR,  r16)) gData.fuelSupplyPressure = r16 * 0.1f;
    if (readReg32Silent(REG_FUEL_RAIL_PR_H, r32)) gData.fuelRailPressure = r32 * 0.1f;

    // CAN status
    if (readReg16(REG_CAN_STATUS, r16)) gData.canStatus = r16;

    // Charging alternator ×0.001 V
    if (readReg16(REG_CHARGE_ALT_V, r16)) gData.chargeAltVoltage = r16 * 0.001f;

    // Engine hours 32-bit ×0.05
    if (readReg32(REG_ENGINE_HRS_H, r32)) {
        gData.engineHoursRaw = r32;
        gData.engineHoursF   = r32 * 0.05f;
    }
    if (readReg16(REG_START_ATTEMPTS, r16)) gData.startAttempts = r16;

    // Fuel level
    if (readReg16(REG_FUEL_LEVEL_PCT, r16)) gData.fuelLevelPct = r16;
    if (readReg16(REG_FUEL_LEVEL_L,   r16)) gData.fuelLevelL   = r16;

    // PGI firmware version
    if (readReg16Silent(REG_PGI_MAJOR, r16)) gData.pgiMajor = (uint8_t)(r16 & 0xFF);
    if (readReg16Silent(REG_PGI_MINOR, r16)) gData.pgiMinor = (uint8_t)(r16 & 0xFF);

    // Utility voltages L-N
    if (readReg16(REG_UTIL_VOLT_L1N, r16)) gData.utilVoltL1N = (float)r16;
    if (readReg16(REG_UTIL_VOLT_L2N, r16)) gData.utilVoltL2N = (float)r16;
    if (readReg16(REG_UTIL_VOLT_L3N, r16)) gData.utilVoltL3N = (float)r16;

    // Utility voltages L-L
    if (readReg16(REG_UTIL_VOLT_L1L2, r16)) gData.utilVoltL1L2 = (float)r16;
    if (readReg16(REG_UTIL_VOLT_L2L3, r16)) gData.utilVoltL2L3 = (float)r16;
    if (readReg16(REG_UTIL_VOLT_L3L1, r16)) gData.utilVoltL3L1 = (float)r16;

    // Utility frequency 32-bit ×0.001 Hz
    if (readReg32Silent(REG_UTIL_FREQ_H, r32)) gData.utilFrequency = r32 * 0.001f;

    // AMF & transfer switch
    if (readReg16Silent(REG_AMF_STATE,      r16)) gData.amfState     = r16;
    if (readReg16Silent(REG_XFER_SW_STATUS, r16)) gData.xferSwStatus = r16;

    // Digital output status
    if (readReg16Silent(REG_FUEL_SHUTOFF, r16)) gData.fuelShutoffStatus = r16;
    if (readReg16Silent(REG_STARTER_OUT,  r16)) gData.starterStatus     = r16;

    // Customer inputs
    if (readReg16Silent(REG_CUST_INPUT1, r16)) gData.custInput1 = r16;
    if (readReg16Silent(REG_CUST_INPUT2, r16)) gData.custInput2 = r16;
    if (readReg16Silent(REG_CUST_INPUT3, r16)) gData.custInput3 = r16;
    if (readReg16Silent(REG_CUST_INPUT4, r16)) gData.custInput4 = r16;
    if (readReg16Silent(REG_CUST_INPUT5, r16)) gData.custInput5 = r16;
    if (readReg16Silent(REG_CUST_INPUT6, r16)) gData.custInput6 = r16;

    // Battery thresholds
    if (readReg16Silent(REG_LOW_BATT_THRESH,  r16)) gData.lowBattThreshold  = r16 * 0.1f;
    if (readReg16Silent(REG_HIGH_BATT_THRESH, r16)) gData.highBattThreshold = r16 * 0.1f;

    // Exercise scheduler state
    if (readReg16Silent(REG_SCHEDULER_STATE, r16)) gData.schedulerState = r16;

    // Shutdown fault queue (10 rows)
    if (readBlock(REG_SHUT_FAULT_1, 10, blk))
        memcpy(gData.shutdownFaults, blk, sizeof(gData.shutdownFaults));

    // Warning fault queue (10 rows)
    if (readBlock(REG_WARN_FAULT_1, 10, blk))
        memcpy(gData.warningFaults, blk, sizeof(gData.warningFaults));

    // ECM engine operating state (may not respond on all units)
    {
        uint8_t status = modbus.readHoldingRegisters(REG_ENGINE_OP_STATE, 1);
        gData.engineOpState = (status == ModbusMaster::ku8MBSuccess)
                              ? modbus.getResponseBuffer(0) : 0xFF;
    }

    // Coolant pressure ECM
    {
        uint8_t status = modbus.readHoldingRegisters(REG_COOLANT_PRESS, 1);
        gData.coolantPressure = (status == ModbusMaster::ku8MBSuccess)
                                ? (int16_t)modbus.getResponseBuffer(0) * 0.1f : 0.0f;
    }

    // Model & serial number
    readStringReg(REG_MODEL_NUM,  gData.modelNumber,  sizeof(gData.modelNumber));
    readStringReg(REG_SERIAL_NUM, gData.serialNumber, sizeof(gData.serialNumber));

    gData.valid = true;

    Serial.printf(
        "[POLL] %-18s | RPM=%6.1f | Freq=%5.2fHz | kW=%5.0f | kVA=%5.0f\n"
        "       GenV: L1=%3.0f L2=%3.0f L3=%3.0fV | I: L1=%4.0f L2=%4.0f L3=%4.0fA\n"
        "       UtilV: L1=%3.0f L2=%3.0f L3=%3.0fV | UtilHz=%.3f | AMF=%s\n"
        "       Cool=%.1f°F | OilP=%.1fpsi | Exh=%.1f°F | Batt=%.3fV | Fuel=%u%%(%uL)\n",
        decodeGensetState(gData.gensetState),
        gData.engineRPM, gData.frequency, gData.kwTotal, gData.kvaTotal,
        gData.voltL1N, gData.voltL2N, gData.voltL3N,
        gData.currL1,  gData.currL2,  gData.currL3,
        gData.utilVoltL1N, gData.utilVoltL2N, gData.utilVoltL3N,
        gData.utilFrequency,
        decodeAmfState(gData.amfState),
        gData.coolantTemp, gData.oilPressure, gData.exhaustTemp,
        gData.battVoltage, gData.fuelLevelPct, gData.fuelLevelL
    );
}

// ════════════════════════════════════════════════════════════════
//  MQTT CALLBACK (incoming commands)
// ════════════════════════════════════════════════════════════════
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg;
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
    Serial.printf("[MQTT←] topic=%s  msg=%s\n", topic, msg.c_str());
    // TODO: parse cmd and write Modbus command registers
}

// ════════════════════════════════════════════════════════════════
//  MQTT CONNECT (called from setup and reconnect watchdog)
// ════════════════════════════════════════════════════════════════
void mqttConnect() {
    if (WiFi.status() != WL_CONNECTED) return;

    // FIX #7 — setServer/setCallback only need to be set once but safe to repeat
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);

    uint8_t tries = 0;
    while (!mqttClient.connected() && tries < 5) {
        Serial.printf("[MQTT] Connecting to %s ...\n", MQTT_BROKER);
        if (mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)) {
            Serial.println("[MQTT] Connected ✓");
            mqttClient.subscribe(MQTT_TOPIC_CMD, 1);
        } else {
            Serial.printf("[MQTT] Failed rc=%d — retry %u/5\n",
                          mqttClient.state(), ++tries);
            delay(2000);
        }
    }
}

// ════════════════════════════════════════════════════════════════
//  BUILD JSON AND PUBLISH VIA MQTT
// ════════════════════════════════════════════════════════════════
void sendToServer() {
    if (!mqttClient.connected()) {
        Serial.println("[MQTT] Not connected — skipping publish");
        return;
    }

    float pf = (gData.kvaTotal > 0.1f) ? gData.kwTotal / gData.kvaTotal : 0.0f;

    DynamicJsonDocument doc(3072);  // FIX #4 — increased from 2048

    doc["timestamp"]         = millis();
    doc["stateCode"]         = gData.gensetState;
    doc["stateLabel"]        = decodeGensetState(gData.gensetState);
    doc["faultCode"]         = gData.faultCode;
    doc["faultSeverity"]     = gData.faultSeverity;
    doc["nfpa110"]           = gData.nfpa110;
    doc["switchPos"]         = gData.switchPosition;
    doc["amberWarn"]         = gData.amberWarnLamp;
    doc["canStatus"]         = gData.canStatus;
    doc["canStatusLabel"]    = decodeCanStatus(gData.canStatus);
    doc["amfState"]          = gData.amfState;
    doc["amfStateLabel"]     = decodeAmfState(gData.amfState);
    doc["xferSwStatus"]      = gData.xferSwStatus;
    doc["xferSwLabel"]       = decodeXferSwitch(gData.xferSwStatus);
    doc["schedulerState"]    = gData.schedulerState;
    doc["fuelShutoffActive"] = gData.fuelShutoffStatus;
    doc["starterActive"]     = gData.starterStatus;
    doc["pgiVersion"]        = String(gData.pgiMajor) + "." +
                               String(gData.pgiMinor) + "." +
                               String(gData.pgiInfo);
    doc["modelNumber"]       = gData.modelNumber;
    doc["serialNumber"]      = gData.serialNumber;
    doc["startAttempts"]     = gData.startAttempts;

    JsonObject inputs = doc.createNestedObject("inputs");
    inputs["in1"] = gData.custInput1;
    inputs["in2"] = gData.custInput2;
    inputs["in3"] = gData.custInput3;
    inputs["in4"] = gData.custInput4;
    inputs["in5"] = gData.custInput5;
    inputs["in6"] = gData.custInput6;

    JsonObject ac = doc.createNestedObject("ac");
    ac["voltL1N"]   = gData.voltL1N;   ac["voltL2N"]   = gData.voltL2N;   ac["voltL3N"]   = gData.voltL3N;
    ac["voltL1L2"]  = gData.voltL1L2;  ac["voltL2L3"]  = gData.voltL2L3;  ac["voltL3L1"]  = gData.voltL3L1;
    ac["currL1"]    = gData.currL1;    ac["currL2"]    = gData.currL2;    ac["currL3"]    = gData.currL3;
    ac["currPctL1"] = gData.currPctL1; ac["currPctL2"] = gData.currPctL2; ac["currPctL3"] = gData.currPctL3;
    ac["kwL1"]      = gData.kwL1;      ac["kwL2"]      = gData.kwL2;      ac["kwL3"]      = gData.kwL3;
    ac["kwTotal"]   = gData.kwTotal;
    ac["kvarL1"]    = gData.kvarL1;    ac["kvarL2"]    = gData.kvarL2;    ac["kvarL3"]    = gData.kvarL3;
    ac["kvarTotal"] = gData.kvarTotal;
    ac["kvaL1"]     = gData.kvaL1;     ac["kvaL2"]     = gData.kvaL2;     ac["kvaL3"]     = gData.kvaL3;
    ac["kvaTotal"]  = gData.kvaTotal;
    ac["freq"]      = gData.frequency;
    ac["pf"]        = pf;

    JsonObject eng = doc.createNestedObject("engine");
    eng["rpm"]           = gData.engineRPM;
    eng["hours"]         = gData.engineHoursF;
    eng["coolantTempF"]  = gData.coolantTemp;
    eng["oilTempF"]      = gData.oilTemp;
    eng["intakeTempF"]   = gData.intakeTemp;
    eng["fuelTempF"]     = gData.fuelTemp;
    eng["exhaustTempF"]  = gData.exhaustTemp;
    eng["oilPressPsi"]   = gData.oilPressure;
    eng["coolantPsi"]    = gData.coolantPressure;
    eng["boostPressPsi"] = gData.boostPressure;
    eng["crankPressPsi"] = gData.crankcasePressure;
    eng["fuelPressPsi"]  = gData.fuelSupplyPressure;
    eng["fuelRailPsi"]   = gData.fuelRailPressure;
    eng["torquePct"]     = gData.engineTorquePct;
    eng["opState"]       = gData.engineOpState;
    eng["opStateLabel"]  = decodeEngineOpState(gData.engineOpState);

    JsonObject elec = doc.createNestedObject("electrical");
    elec["battV"]          = gData.battVoltage;
    elec["chargeAltV"]     = gData.chargeAltVoltage;
    elec["lowBattThresh"]  = gData.lowBattThreshold;
    elec["highBattThresh"] = gData.highBattThreshold;

    JsonObject fuel = doc.createNestedObject("fuel");
    fuel["pct"]    = gData.fuelLevelPct;
    fuel["litres"] = gData.fuelLevelL;

    JsonObject util = doc.createNestedObject("utility");
    util["voltL1N"]  = gData.utilVoltL1N;  util["voltL2N"]  = gData.utilVoltL2N;  util["voltL3N"]  = gData.utilVoltL3N;
    util["voltL1L2"] = gData.utilVoltL1L2; util["voltL2L3"] = gData.utilVoltL2L3; util["voltL3L1"] = gData.utilVoltL3L1;
    util["freq"]     = gData.utilFrequency;

    JsonArray sdFaults = doc.createNestedArray("shutdownFaults");
    for (int i = 0; i < 10; i++) sdFaults.add(gData.shutdownFaults[i]);

    JsonArray warnFaults = doc.createNestedArray("warningFaults");
    for (int i = 0; i < 10; i++) warnFaults.add(gData.warningFaults[i]);

    String payload;
    serializeJson(doc, payload);

    bool ok = mqttClient.publish(MQTT_TOPIC_DATA, payload.c_str(), false);
    Serial.printf("[MQTT→] publish %s  (%u bytes)\n",
                  ok ? "OK" : "FAIL", payload.length());

    // FIX #1 — HTTP POST block REMOVED.
    // It had no SERVER_URL, fired a broken request every 2 seconds,
    // stressed the WiFi stack and caused MQTT to drop.
    // Re-enable when you have a valid server URL.
}

// ════════════════════════════════════════════════════════════════
//  WIFI CONNECT
// ════════════════════════════════════════════════════════════════
void connectWiFi() {
    Serial.printf("[WiFi] Connecting to \"%s\"\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    uint8_t tries = 0;
    while (WiFi.status() != WL_CONNECTED && tries < 40) {
        delay(500);
        Serial.print('.');
        tries++;
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WiFi] Connected ✓  IP: %s\n", WiFi.localIP().toString().c_str());
        digitalWrite(WIFI_LED_PIN, HIGH);
    } else {
        Serial.println("[WiFi] Failed — will retry on next cycle");
        digitalWrite(WIFI_LED_PIN, LOW);
    }
}

// ════════════════════════════════════════════════════════════════
//  MODBUS DIAGNOSTIC — call once from setup() to test connection
// ════════════════════════════════════════════════════════════════
void modbusRawTest() {
    Serial.println("\n[DIAG] ═══ RAW MODBUS TEST START ═══");

    // Test 1 — try slave ID 1, register 0, just 1 register
    Serial.println("[DIAG] Test 1: Slave=1, Addr=0, Count=1");
    uint8_t result = modbus.readHoldingRegisters(0, 1);
    Serial.printf("[DIAG] Result=0x%02X  %s\n", result,
        result == ModbusMaster::ku8MBSuccess ? "SUCCESS ✓" :
        result == 0xE2 ? "TIMEOUT — no reply from slave" :
        result == 0xE3 ? "INVALID SLAVE ID" :
        result == 0xE4 ? "INVALID FUNCTION" :
        result == 0xE6 ? "INVALID CRC" : "OTHER ERROR");

    delay(200);

    // Test 2 — try slave ID 1, register 8 (device type)
    Serial.println("[DIAG] Test 2: Slave=1, Addr=8, Count=1");
    result = modbus.readHoldingRegisters(8, 1);
    Serial.printf("[DIAG] Result=0x%02X  val=%u\n", result,
        result == ModbusMaster::ku8MBSuccess ? modbus.getResponseBuffer(0) : 0);

    delay(200);

    // Test 3 — try broadcast slave ID 0 (some devices need this first)
    Serial.println("[DIAG] Test 3: Changing to Slave=2, Addr=8");
    modbus.begin(2, modbusSerial);
    result = modbus.readHoldingRegisters(8, 1);
    Serial.printf("[DIAG] Slave2 Result=0x%02X\n", result);
    modbus.begin(MODBUS_SLAVE_ID, modbusSerial); // restore
    modbus.preTransmission(preTransmission);
    modbus.postTransmission(postTransmission);

    delay(200);

    // Test 4 — check DE/RE pin is actually toggling
    Serial.println("[DIAG] Test 4: DE/RE pin toggle check");
    Serial.printf("[DIAG] GPIO%d state before TX = %d (should be 0)\n",
        RS485_DE_RE_PIN, digitalRead(RS485_DE_RE_PIN));
    digitalWrite(RS485_DE_RE_PIN, HIGH);
    Serial.printf("[DIAG] GPIO%d state forced HIGH = %d\n",
        RS485_DE_RE_PIN, digitalRead(RS485_DE_RE_PIN));
    digitalWrite(RS485_DE_RE_PIN, LOW);
    Serial.printf("[DIAG] GPIO%d state forced LOW  = %d\n",
        RS485_DE_RE_PIN, digitalRead(RS485_DE_RE_PIN));

    Serial.println("[DIAG] ═══ RAW MODBUS TEST END ═══\n");
}

// ════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n╔══════════════════════════════════════════════════════════════╗");
    Serial.println("║  Cummins 400kVA DG Monitor  ·  PS0600  ·  A029X159 Issue 29 ║");
    Serial.println("╚══════════════════════════════════════════════════════════════╝");

    pinMode(RS485_DE_RE_PIN, OUTPUT);
    digitalWrite(RS485_DE_RE_PIN, LOW);
    pinMode(WIFI_LED_PIN, OUTPUT);
digitalWrite(WIFI_LED_PIN, LOW);

    modbusSerial.begin(RS485_BAUD_RATE, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
    modbus.begin(MODBUS_SLAVE_ID, modbusSerial);
    modbus.preTransmission(preTransmission);
    modbus.postTransmission(postTransmission);
    Serial.printf("[MB]  Slave=%d | Baud=%d | RX:GPIO%d  TX:GPIO%d  DE/RE:GPIO%d\n",
        MODBUS_SLAVE_ID, RS485_BAUD_RATE,
        RS485_RX_PIN, RS485_TX_PIN, RS485_DE_RE_PIN);

    memset(&gData, 0, sizeof(gData));

    connectWiFi();

    // add this line:
    modbusRawTest();
    // FIX #3 & #5 — configure MQTT BEFORE connecting
    // setInsecure moved here from mqttConnect() — called once only
    wifiSecure.setInsecure();
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setKeepAlive(60);      // FIX #3 — was 15s default, now 60s
    mqttClient.setBufferSize(3072);   // FIX #4 — was 2048, payload ~1460 bytes
    mqttClient.setSocketTimeout(30);

    mqttConnect();

    Serial.println("[SYS] Setup complete — entering polling loop\n");
}

// ════════════════════════════════════════════════════════════════
//  LOOP
// ════════════════════════════════════════════════════════════════
void loop() {
    unsigned long now = millis();

    // FIX #2 — call mqttClient.loop() at the TOP of every iteration
    // This is the most important fix — MQTT keepalive must run constantly
    if (mqttClient.connected()) {
        mqttClient.loop();
    }

    // WiFi reconnect watchdog
    // WiFi status LED + reconnect watchdog
    if (WiFi.status() != WL_CONNECTED) {
        static unsigned long lastBlinkMs = 0;
        static bool ledState = false;
        if (now - lastBlinkMs >= 300) {
            lastBlinkMs = now;
            ledState = !ledState;
            digitalWrite(WIFI_LED_PIN, ledState ? HIGH : LOW);
        }

        if (now - lastWifiRetry > 15000) {
            lastWifiRetry = now;
            Serial.println("[WiFi] Reconnecting...");
            connectWiFi();
        }
    } else {
        digitalWrite(WIFI_LED_PIN, HIGH);
    }

    // Poll Modbus and publish every POLL_INTERVAL_MS
    if (now - lastPollMs >= POLL_INTERVAL_MS) {
        lastPollMs = now;

        pollModbus();

        // Call loop() again after the ~1s Modbus scan to prevent keepalive timeout
        if (mqttClient.connected()) mqttClient.loop();

        if (gData.valid) sendToServer();

        // Call loop() once more after publish
        if (mqttClient.connected()) mqttClient.loop();
    }

    // MQTT reconnect watchdog — only triggers when truly disconnected
    if (WiFi.status() == WL_CONNECTED && !mqttClient.connected()) {
        if (now - lastMqttRetry > 10000) {
            lastMqttRetry = now;
            Serial.println("[MQTT] Reconnecting...");
            mqttConnect();
        }
    }

    yield();
}

///blue down
// grey up