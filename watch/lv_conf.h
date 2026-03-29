/**
 * lv_conf.h — LVGL configuration for SV-Esperanza Watch
 * Waveshare ESP32-S3-Touch-AMOLED-2.06 · 240×536 AMOLED
 */
#if 1  /* Set to 1 to enable content */

#ifndef LV_CONF_H
#define LV_CONF_H

#include <stdint.h>

/* Color depth: 1 (1 byte per pixel), 8, 16, 32 */
#define LV_COLOR_DEPTH 16

/* Swap the 2 bytes of RGB565 color (big-endian displays) */
#define LV_COLOR_16_SWAP 0

/* Screen resolution */
#define LV_HOR_RES_MAX 240
#define LV_VER_RES_MAX 536

/* Memory */
#define LV_MEM_SIZE (64 * 1024U)   /* 64 KB LVGL heap */

/* ── FONTS ─────────────────────────────────────────────────── */
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_24 1
#define LV_FONT_MONTSERRAT_36 1
#define LV_FONT_MONTSERRAT_48 1
#define LV_FONT_DEFAULT &lv_font_montserrat_14

/* ── FEATURES ───────────────────────────────────────────────── */
#define LV_USE_ANIMATION  1
#define LV_USE_SHADOW     0   /* Disable shadows — saves RAM on AMOLED */
#define LV_USE_BLEND_MODES 0
#define LV_USE_OPA_SCALE  1

/* ── WIDGETS ────────────────────────────────────────────────── */
#define LV_USE_BTN     1
#define LV_USE_LABEL   1
#define LV_USE_ARC     1
#define LV_USE_BAR     1
#define LV_USE_IMG     0
#define LV_USE_LINE    1
#define LV_USE_TABLE   0
#define LV_USE_CHECKBOX 0
#define LV_USE_DROPDOWN 0
#define LV_USE_ROLLER  0
#define LV_USE_SLIDER  0
#define LV_USE_SWITCH  1
#define LV_USE_TEXTAREA 0
#define LV_USE_SPINBOX 0
#define LV_USE_LIST    0
#define LV_USE_MSGBOX  0
#define LV_USE_TABVIEW 0
#define LV_USE_TILEVIEW 1   /* Used for swiping between modes */
#define LV_USE_WIN     0

/* ── LOGGING ────────────────────────────────────────────────── */
#define LV_USE_LOG    1
#define LV_LOG_LEVEL  LV_LOG_LEVEL_WARN

/* ── TICK ───────────────────────────────────────────────────── */
/* lv_tick_inc() called from a hardware timer or millis() wrapper */
#define LV_TICK_CUSTOM 1
#define LV_TICK_CUSTOM_INCLUDE <Arduino.h>
#define LV_TICK_CUSTOM_SYS_TIME_EXPR (millis())

#endif /* LV_CONF_H */
#endif /* End enable/disable content */
