#pragma once
#include "esphome.h"
#include "lwip/sockets.h"

const char* SIGNALK_HOST = "192.168.8.201";
const int   SIGNALK_PORT = 10110;

static int nmea_sock = -1;
static unsigned long last_connect_attempt = 0;
const unsigned long RECONNECT_INTERVAL_MS = 5000;

static bool nmea_connect() {
  int sock = lwip_socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) {
    ESP_LOGW("nmea", "Socket create failed: %d", errno);
    return false;
  }
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port   = htons(SIGNALK_PORT);
  addr.sin_addr.s_addr = inet_addr(SIGNALK_HOST);
  if (lwip_connect(sock, (struct sockaddr*)&addr, sizeof(addr)) != 0) {
    ESP_LOGW("nmea", "Connect to %s:%d failed: %d", SIGNALK_HOST, SIGNALK_PORT, errno);
    lwip_close(sock);
    return false;
  }
  nmea_sock = sock;
  ESP_LOGI("nmea", "Connected to SignalK %s:%d", SIGNALK_HOST, SIGNALK_PORT);
  return true;
}

void nmea_push(const char* sentence) {
  if (nmea_sock < 0) {
    unsigned long now = millis();
    if (now - last_connect_attempt > RECONNECT_INTERVAL_MS) {
      last_connect_attempt = now;
      nmea_connect();
    }
    return;
  }
  int len = strlen(sentence);
  int sent = lwip_send(nmea_sock, sentence, len, 0);
  if (sent < 0) {
    ESP_LOGW("nmea", "Send failed: %d — reconnecting", errno);
    lwip_close(nmea_sock);
    nmea_sock = -1;
  } else {
    ESP_LOGD("nmea", "TX: %s", sentence);
  }
}
