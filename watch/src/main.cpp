// ============================================================
// SV-Esperanza Watch Firmware
// Device: Waveshare ESP32-S3-Touch-AMOLED-2.06
//
// MODES (auto-switch + manual swipe):
//   MODE_AUTOPILOT   — ±1° / ±10° heading adjust, engage/release
//   MODE_INSTRUMENTS — speed, depth, wind, battery, temp
//   MODE_ANCHOR      — relay controls, anchor alarm radius
//
// AUTO-SWITCHING:
//   - SignalK autopilot.state == "engaged"  → MODE_AUTOPILOT
//   - SOG > 0.5 kn && autopilot disengaged  → MODE_INSTRUMENTS
//   - SOG < 0.3 kn for 60s                  → MODE_ANCHOR
//
// CONNECTIVITY:
//   - WiFiMulti: SV-Esperanza primary, phone hotspot fallback
//   - SignalK WebSocket: ws://sailboatserver.local:3000/signalk/v1/stream
//   - relay_server HTTP: http://sailboatserver.local/api/relay/<ch>
//
// BUILD:
//   Arduino IDE or PlatformIO with ESP32-S3 board support
//   Dependencies: lvgl (>=9.x), ArduinoJson, WebSockets, WiFiMulti
//
// WIRING: see docs/watch_wiring.md
// ============================================================

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WebSocketsClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <lvgl.h>
#include "secrets.h"  // auto-generated from esphome/secrets.yaml — run scripts/gen_watch_secrets.py

// ── SERVER ADDRESSES ─────────────────────────────────────────
#define SIGNALK_HOST       "sailboatserver.local"
#define SIGNALK_WS_PORT    3000
#define SIGNALK_WS_PATH    "/signalk/v1/stream?subscribe=none"

#define RELAY_BASE_URL     "http://sailboatserver.local/api/relay"

// ── DISPLAY ──────────────────────────────────────────────────
// Waveshare ESP32-S3-Touch-AMOLED-2.06
// Display driver: RM67162 AMOLED via QSPI
// Touch: CST816S I2C
// Screen: 240x536 px
#define SCREEN_W  240
#define SCREEN_H  536

// ── MODES ────────────────────────────────────────────────────
enum WatchMode {
  MODE_AUTOPILOT   = 0,
  MODE_INSTRUMENTS = 1,
  MODE_ANCHOR      = 2,
  MODE_COUNT       = 3
};

// ── LIVE DATA ────────────────────────────────────────────────
struct BoatData {
  float sog         = 0.0f;   // speed over ground (kn)
  float cog         = 0.0f;   // course over ground (deg)
  float stw         = 0.0f;   // speed through water (kn)
  float depth       = 0.0f;   // depth below transducer (m)
  float tws         = 0.0f;   // true wind speed (kn)
  float twa         = 0.0f;   // true wind angle (deg)
  float heading     = 0.0f;   // magnetic heading (deg)
  float rudder      = 0.0f;   // rudder angle (deg)
  float battV       = 0.0f;   // battery voltage (V)
  float battA       = 0.0f;   // battery current (A)
  float tempCabin   = 0.0f;   // cabin temp (°C)
  bool  apEngaged   = false;  // autopilot engaged
  float apHeading   = 0.0f;   // autopilot target heading (deg)
};

// ── RELAY STATE ──────────────────────────────────────────────
struct RelayState {
  bool cabin    = false;  // CH1 cabin lights
  bool navLight = false;  // CH2 nav lights
  bool anchor   = false;  // CH3 anchor light
  bool bilge    = false;  // CH4 bilge pump
  bool water    = false;  // CH5 water pump
  bool vent     = false;  // CH6 vent fan
  bool instr    = false;  // CH7 instruments
  bool starlink = false;  // CH8 starlink
};

// ── GLOBALS ──────────────────────────────────────────────────
WiFiMulti wifiMulti;
WebSocketsClient wsClient;
BoatData boat;
RelayState relays;
WatchMode currentMode    = MODE_INSTRUMENTS;
WatchMode requestedMode  = MODE_INSTRUMENTS;
bool      wsConnected    = false;
unsigned long lastSogHighMs  = 0;
unsigned long sogLowStartMs  = 0;

// ── LVGL DISPLAY BUFFER ──────────────────────────────────────
// TODO: initialize display driver for RM67162 AMOLED
// Reference: Waveshare ESP32-S3-Touch-AMOLED-2.06 Arduino demo
static lv_disp_draw_buf_t draw_buf;
static lv_color_t buf1[SCREEN_W * 20];

// ── FORWARD DECLARATIONS ─────────────────────────────────────
void initDisplay();
void initLVGL();
void switchMode(WatchMode mode);
void buildAutopilotUI();
void buildInstrumentsUI();
void buildAnchorUI();
void updateAutopilotUI();
void updateInstrumentsUI();
void updateAnchorUI();
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
void parseSignalKDelta(const char* json);
void postRelayToggle(int channel);
void postRelaySet(int channel, bool on);
void fetchRelayState();
void autoSwitchMode();

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);

  // WiFi — try boat network first, phone hotspot fallback
  wifiMulti.addAP(WIFI_SSID_BOAT,  WIFI_PASS_BOAT);
  wifiMulti.addAP(WIFI_SSID_PHONE, WIFI_PASS_PHONE);
  Serial.print("Connecting WiFi");
  while (wifiMulti.run() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" connected: " + WiFi.SSID());

  // Display + LVGL
  initDisplay();
  initLVGL();

  // SignalK WebSocket
  wsClient.begin(SIGNALK_HOST, SIGNALK_WS_PORT, SIGNALK_WS_PATH);
  wsClient.onEvent(onWebSocketEvent);
  wsClient.setReconnectInterval(5000);

  // Subscribe to relevant paths after connect (see onWebSocketEvent)
  fetchRelayState();
  switchMode(MODE_INSTRUMENTS);
}

// ============================================================
// LOOP
// ============================================================
void loop() {
  // Reconnect WiFi if dropped
  if (wifiMulti.run() != WL_CONNECTED) {
    wsConnected = false;
  }

  wsClient.loop();
  lv_timer_handler();
  autoSwitchMode();
  delay(5);
}

// ============================================================
// DISPLAY INIT
// ============================================================
void initDisplay() {
  // TODO: initialize RM67162 AMOLED via QSPI
  // See Waveshare ESP32-S3-Touch-AMOLED-2.06 Arduino examples:
  //   https://github.com/Waveshare/AMOLED-LVGL
  // Key pins (check schematic for exact GPIO):
  //   QSPI: CS, CLK, D0-D3
  //   Touch CST816S: SDA=GPIO6, SCL=GPIO7, INT=GPIO9, RST=GPIO8
}

void initLVGL() {
  lv_init();
  lv_disp_draw_buf_init(&draw_buf, buf1, NULL, SCREEN_W * 20);

  // TODO: register display driver once initDisplay() is implemented
  // lv_disp_drv_t disp_drv;
  // lv_disp_drv_init(&disp_drv);
  // disp_drv.hor_res = SCREEN_W;
  // disp_drv.ver_res = SCREEN_H;
  // disp_drv.flush_cb = my_disp_flush;
  // disp_drv.draw_buf = &draw_buf;
  // lv_disp_drv_register(&disp_drv);

  // TODO: register touch input driver
  // lv_indev_drv_t indev_drv;
  // lv_indev_drv_init(&indev_drv);
  // indev_drv.type = LV_INDEV_TYPE_POINTER;
  // indev_drv.read_cb = my_touch_read;
  // lv_indev_drv_register(&indev_drv);
}

// ============================================================
// MODE SWITCHING
// ============================================================
void switchMode(WatchMode mode) {
  lv_obj_clean(lv_scr_act());
  currentMode = mode;
  switch (mode) {
    case MODE_AUTOPILOT:   buildAutopilotUI();   break;
    case MODE_INSTRUMENTS: buildInstrumentsUI(); break;
    case MODE_ANCHOR:      buildAnchorUI();       break;
  }
}

void autoSwitchMode() {
  unsigned long now = millis();

  // AP engaged → autopilot mode
  if (boat.apEngaged && currentMode != MODE_AUTOPILOT) {
    switchMode(MODE_AUTOPILOT);
    return;
  }

  // Moving + AP off → instruments
  if (!boat.apEngaged && boat.sog > 0.5f) {
    lastSogHighMs = now;
    if (currentMode == MODE_ANCHOR) switchMode(MODE_INSTRUMENTS);
    return;
  }

  // Slow for 60s → anchor mode
  if (!boat.apEngaged && boat.sog < 0.3f) {
    if (sogLowStartMs == 0) sogLowStartMs = now;
    if ((now - sogLowStartMs) > 60000UL && currentMode != MODE_ANCHOR) {
      switchMode(MODE_ANCHOR);
    }
  } else {
    sogLowStartMs = 0;
  }
}

// ============================================================
// UI BUILDERS — AUTOPILOT MODE
// ============================================================
void buildAutopilotUI() {
  lv_obj_t* scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, lv_color_black(), 0);

  // Heading display
  lv_obj_t* headingLabel = lv_label_create(scr);
  lv_obj_align(headingLabel, LV_ALIGN_TOP_MID, 0, 20);
  lv_obj_set_style_text_font(headingLabel, &lv_font_montserrat_48, 0);
  lv_obj_set_style_text_color(headingLabel, lv_color_white(), 0);
  lv_label_set_text_fmt(headingLabel, "%.0f°", boat.apHeading);

  // -10° button
  lv_obj_t* btnM10 = lv_btn_create(scr);
  lv_obj_set_size(btnM10, 90, 70);
  lv_obj_align(btnM10, LV_ALIGN_LEFT_MID, 10, 0);
  lv_obj_t* lblM10 = lv_label_create(btnM10);
  lv_label_set_text(lblM10, "-10°");
  lv_obj_center(lblM10);
  lv_obj_add_event_cb(btnM10, [](lv_event_t* e) {
    // TODO: POST autopilot adjust -10° to SignalK or relay_server
  }, LV_EVENT_CLICKED, NULL);

  // -1° button
  lv_obj_t* btnM1 = lv_btn_create(scr);
  lv_obj_set_size(btnM1, 90, 70);
  lv_obj_align(btnM1, LV_ALIGN_LEFT_MID, 10, 90);
  lv_obj_t* lblM1 = lv_label_create(btnM1);
  lv_label_set_text(lblM1, "-1°");
  lv_obj_center(lblM1);

  // +1° button
  lv_obj_t* btnP1 = lv_btn_create(scr);
  lv_obj_set_size(btnP1, 90, 70);
  lv_obj_align(btnP1, LV_ALIGN_RIGHT_MID, -10, 90);
  lv_obj_t* lblP1 = lv_label_create(btnP1);
  lv_label_set_text(lblP1, "+1°");
  lv_obj_center(lblP1);

  // +10° button
  lv_obj_t* btnP10 = lv_btn_create(scr);
  lv_obj_set_size(btnP10, 90, 70);
  lv_obj_align(btnP10, LV_ALIGN_RIGHT_MID, -10, 0);
  lv_obj_t* lblP10 = lv_label_create(btnP10);
  lv_label_set_text(lblP10, "+10°");
  lv_obj_center(lblP10);

  // Disengage button
  lv_obj_t* btnDis = lv_btn_create(scr);
  lv_obj_set_size(btnDis, 180, 60);
  lv_obj_align(btnDis, LV_ALIGN_BOTTOM_MID, 0, -20);
  lv_obj_set_style_bg_color(btnDis, lv_palette_main(LV_PALETTE_RED), 0);
  lv_obj_t* lblDis = lv_label_create(btnDis);
  lv_label_set_text(lblDis, "DISENGAGE");
  lv_obj_center(lblDis);
}

// ============================================================
// UI BUILDERS — INSTRUMENTS MODE
// ============================================================
void buildInstrumentsUI() {
  lv_obj_t* scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, lv_color_black(), 0);

  // Create a 2-column grid of instrument tiles:
  // SOG | COG
  // STW | Depth
  // TWS | TWA
  // Batt V | Batt A

  const int TILE_W = SCREEN_W / 2 - 6;
  const int TILE_H = 110;

  struct { const char* label; float* value; const char* unit; } tiles[] = {
    {"SOG",    &boat.sog,   "kn"},
    {"COG",    &boat.cog,   "°"},
    {"STW",    &boat.stw,   "kn"},
    {"Depth",  &boat.depth, "m"},
    {"TWS",    &boat.tws,   "kn"},
    {"TWA",    &boat.twa,   "°"},
    {"Batt",   &boat.battV, "V"},
    {"Current",&boat.battA, "A"},
  };

  for (int i = 0; i < 8; i++) {
    int col = i % 2;
    int row = i / 2;
    lv_obj_t* tile = lv_obj_create(scr);
    lv_obj_set_size(tile, TILE_W, TILE_H);
    lv_obj_set_pos(tile, col * (TILE_W + 6) + 3, row * (TILE_H + 4) + 4);
    lv_obj_set_style_bg_color(tile, lv_color_hex(0x111111), 0);
    lv_obj_set_style_border_color(tile, lv_color_hex(0x333333), 0);
    lv_obj_set_style_radius(tile, 8, 0);

    lv_obj_t* lbl = lv_label_create(tile);
    lv_label_set_text(lbl, tiles[i].label);
    lv_obj_set_style_text_color(lbl, lv_color_hex(0x888888), 0);
    lv_obj_align(lbl, LV_ALIGN_TOP_LEFT, 6, 6);

    lv_obj_t* val = lv_label_create(tile);
    lv_label_set_text_fmt(val, "%.1f", *tiles[i].value);
    lv_obj_set_style_text_font(val, &lv_font_montserrat_36, 0);
    lv_obj_set_style_text_color(val, lv_color_white(), 0);
    lv_obj_align(val, LV_ALIGN_CENTER, 0, 8);

    lv_obj_t* unit = lv_label_create(tile);
    lv_label_set_text(unit, tiles[i].unit);
    lv_obj_set_style_text_color(unit, lv_color_hex(0x888888), 0);
    lv_obj_align(unit, LV_ALIGN_BOTTOM_RIGHT, -6, -6);
  }
}

// ============================================================
// UI BUILDERS — ANCHOR MODE
// ============================================================
void buildAnchorUI() {
  lv_obj_t* scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, lv_color_black(), 0);

  // Title
  lv_obj_t* title = lv_label_create(scr);
  lv_label_set_text(title, "AT ANCHOR");
  lv_obj_set_style_text_color(title, lv_color_hex(0xFFAA00), 0);
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 12);

  // Relay toggle buttons (label, channel)
  struct { const char* label; int ch; bool* state; } btns[] = {
    {"Cabin",    1, &relays.cabin},
    {"Nav Lts",  2, &relays.navLight},
    {"Anchor Lt",3, &relays.anchor},
    {"Bilge",    4, &relays.bilge},
    {"Water",    5, &relays.water},
    {"Vent",     6, &relays.vent},
    {"Instr",    7, &relays.instr},
    {"Starlink", 8, &relays.starlink},
  };

  const int BTN_W = 100, BTN_H = 54;
  for (int i = 0; i < 8; i++) {
    int col = i % 2;
    int row = i / 2;
    lv_obj_t* btn = lv_btn_create(scr);
    lv_obj_set_size(btn, BTN_W, BTN_H);
    lv_obj_set_pos(btn, col * (BTN_W + 8) + 12, row * (BTN_H + 8) + 50);
    lv_obj_set_style_bg_color(btn,
      *btns[i].state ? lv_palette_main(LV_PALETTE_GREEN)
                     : lv_color_hex(0x333333), 0);
    lv_obj_t* lbl = lv_label_create(btn);
    lv_label_set_text(lbl, btns[i].label);
    lv_obj_set_style_text_font(lbl, &lv_font_montserrat_14, 0);
    lv_obj_center(lbl);
    // Store channel in user_data for callback
    lv_obj_set_user_data(btn, (void*)(intptr_t)btns[i].ch);
    lv_obj_add_event_cb(btn, [](lv_event_t* e) {
      int ch = (int)(intptr_t)lv_obj_get_user_data(lv_event_get_target(e));
      postRelayToggle(ch);
    }, LV_EVENT_CLICKED, NULL);
  }

  // SOG indicator (anchor drag warning)
  lv_obj_t* sogLbl = lv_label_create(scr);
  lv_label_set_text_fmt(sogLbl, "SOG %.1f kn", boat.sog);
  lv_obj_set_style_text_color(sogLbl,
    boat.sog > 0.5f ? lv_palette_main(LV_PALETTE_RED) : lv_color_hex(0x888888), 0);
  lv_obj_align(sogLbl, LV_ALIGN_BOTTOM_MID, 0, -12);
}

// ============================================================
// SIGNALK WEBSOCKET
// ============================================================
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.println("SignalK WS connected");
      // Subscribe to paths we need
      wsClient.sendTXT(
        R"({"context":"vessels.self","subscribe":[
          {"path":"navigation.speedOverGround"},
          {"path":"navigation.courseOverGroundTrue"},
          {"path":"navigation.speedThroughWater"},
          {"path":"environment.depth.belowTransducer"},
          {"path":"environment.wind.speedTrue"},
          {"path":"environment.wind.angleTrueWater"},
          {"path":"navigation.headingMagnetic"},
          {"path":"steering.rudderAngle"},
          {"path":"electrical.batteries.house.voltage"},
          {"path":"electrical.batteries.house.current"},
          {"path":"environment.inside.temperature"},
          {"path":"steering.autopilot.state"},
          {"path":"steering.autopilot.target.headingMagnetic"}
        ]})"
      );
      break;
    case WStype_TEXT:
      parseSignalKDelta((const char*)payload);
      break;
    case WStype_DISCONNECTED:
      wsConnected = false;
      break;
    default:
      break;
  }
}

void parseSignalKDelta(const char* json) {
  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) return;

  JsonArray updates = doc["updates"];
  if (updates.isNull()) return;

  for (JsonObject upd : updates) {
    JsonArray values = upd["values"];
    for (JsonObject v : values) {
      const char* path = v["path"];
      JsonVariant val  = v["value"];
      if (!path) continue;

      if      (strcmp(path, "navigation.speedOverGround")               == 0) boat.sog      = val.as<float>() * 1.94384f; // m/s → kn
      else if (strcmp(path, "navigation.courseOverGroundTrue")          == 0) boat.cog      = val.as<float>() * 57.2958f; // rad → deg
      else if (strcmp(path, "navigation.speedThroughWater")             == 0) boat.stw      = val.as<float>() * 1.94384f;
      else if (strcmp(path, "environment.depth.belowTransducer")        == 0) boat.depth    = val.as<float>();
      else if (strcmp(path, "environment.wind.speedTrue")               == 0) boat.tws      = val.as<float>() * 1.94384f;
      else if (strcmp(path, "environment.wind.angleTrueWater")          == 0) boat.twa      = val.as<float>() * 57.2958f;
      else if (strcmp(path, "navigation.headingMagnetic")               == 0) boat.heading  = val.as<float>() * 57.2958f;
      else if (strcmp(path, "steering.rudderAngle")                     == 0) boat.rudder   = val.as<float>() * 57.2958f;
      else if (strcmp(path, "electrical.batteries.house.voltage")       == 0) boat.battV    = val.as<float>();
      else if (strcmp(path, "electrical.batteries.house.current")       == 0) boat.battA    = val.as<float>();
      else if (strcmp(path, "environment.inside.temperature")           == 0) boat.tempCabin = val.as<float>() - 273.15f; // K → °C
      else if (strcmp(path, "steering.autopilot.state")                 == 0) boat.apEngaged = (strcmp(val.as<const char*>(), "engaged") == 0);
      else if (strcmp(path, "steering.autopilot.target.headingMagnetic")== 0) boat.apHeading = val.as<float>() * 57.2958f;
    }
  }
}

// ============================================================
// RELAY HTTP API
// ============================================================
void postRelayToggle(int channel) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(RELAY_BASE_URL) + "/" + channel;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.POST("{\"action\":\"toggle\"}");
  http.end();
  // Refresh relay state after toggle
  fetchRelayState();
}

void postRelaySet(int channel, bool on) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(RELAY_BASE_URL) + "/" + channel;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"action\":\"") + (on ? "on" : "off") + "\"}";
  http.POST(body);
  http.end();
}

void fetchRelayState() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin("http://sailboatserver.local/api/relays");
  int code = http.GET();
  if (code == 200) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
      relays.cabin    = doc["1"]["state"] | false;
      relays.navLight = doc["2"]["state"] | false;
      relays.anchor   = doc["3"]["state"] | false;
      relays.bilge    = doc["4"]["state"] | false;
      relays.water    = doc["5"]["state"] | false;
      relays.vent     = doc["6"]["state"] | false;
      relays.instr    = doc["7"]["state"] | false;
      relays.starlink = doc["8"]["state"] | false;
    }
  }
  http.end();
}
