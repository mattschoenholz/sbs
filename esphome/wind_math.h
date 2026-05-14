// wind_math.h — host- and ESP32-side wind sensor math for SV-Esperanza.
//
// Pure-C++ (no Arduino/ESPHome deps) so this file can be compiled both:
//   * inside ESPHome lambdas (via `includes:` in sv_esperanza_wind.yaml), and
//   * standalone for parity testing against wind_math.py on a host.
//
// Output must match the Python reference exactly for a given input. See
// test_wind_math_cpp.cpp for the parity harness.
//
// Hardware caveat (firmware-side): masthead 8V supply uses an L7808 (not the
// originally specced LM2940-8 LDO) due to parts availability. L7808 needs ~2V
// headroom — loses regulation below ~10V input. Acceptable for boat use; one
// reading may glitch during engine cranking.

#pragma once

#include <cmath>
#include <cstdio>

namespace wind_math {

// ── Bench-calibrated factory defaults from the 2026-04-25 dock test.
// (See intel_vault: 02_Boat_Project/ST60 Wind Transducer ESP32.md, Phase 3.)
constexpr float FACTORY_COS_OFFSET     = 4.05f;
constexpr float FACTORY_COS_GAIN       = 1.75f;
constexpr float FACTORY_SIN_OFFSET     = 4.10f;
constexpr float FACTORY_SIN_GAIN       = 1.80f;
constexpr float FACTORY_HEADING_OFFSET = 0.0f;
constexpr float FACTORY_KNOTS_PER_HZ   = 1.04f;

struct WindCal {
  float cos_offset     = FACTORY_COS_OFFSET;
  float cos_gain       = FACTORY_COS_GAIN;
  float sin_offset     = FACTORY_SIN_OFFSET;
  float sin_gain       = FACTORY_SIN_GAIN;
  float heading_offset = FACTORY_HEADING_OFFSET;
  float knots_per_hz   = FACTORY_KNOTS_PER_HZ;
};

inline float wrap360(float deg) {
  float r = std::fmod(deg, 360.0f);
  if (r < 0.0f) r += 360.0f;
  return r;
}

// Apparent wind angle [0, 360). NaN on NaN input or undefined atan2(0,0).
inline float compute_awa(float raw_cos, float raw_sin, const WindCal &cal) {
  if (std::isnan(raw_cos) || std::isnan(raw_sin)) return NAN;
  float cos_v = (raw_cos - cal.cos_offset) / cal.cos_gain;
  float sin_v = (raw_sin - cal.sin_offset) / cal.sin_gain;
  if (cos_v == 0.0f && sin_v == 0.0f) return NAN;
  float angle_deg = std::atan2(sin_v, cos_v) * 180.0f / static_cast<float>(M_PI);
  return wrap360(angle_deg + cal.heading_offset);
}

// Apparent wind speed in knots from edge counts over a window. NaN on bad window.
inline float compute_aws_from_pulses(int pulse_count, float time_window_sec,
                                     const WindCal &cal) {
  if (time_window_sec <= 0.0f) return NAN;
  float hz = static_cast<float>(pulse_count) / time_window_sec;
  return hz * cal.knots_per_hz;
}

// NMEA 0183 checksum: XOR of all bytes in `payload` (no leading $ / trailing *cs).
inline unsigned char nmea_checksum(const char *payload) {
  unsigned char cs = 0;
  for (const char *p = payload; *p; ++p) cs ^= static_cast<unsigned char>(*p);
  return cs;
}

// Build "$IIMWV,<angle>,R,<speed>,N,<status>*<cs>\r\n" into `out`.
// `out` must be ≥48 bytes. Returns the number of chars written (excluding NUL).
// NaN in either input or `valid==false` produces a "data invalid" frame ('V').
inline int format_mwv_sentence(float awa_deg, float aws_kt, bool valid,
                               char *out, int out_len) {
  char payload[40];
  bool nan_in = std::isnan(awa_deg) || std::isnan(aws_kt);
  if (nan_in || !valid) {
    std::snprintf(payload, sizeof(payload), "IIMWV,,R,,N,V");
  } else {
    float a = wrap360(awa_deg);
    float s = aws_kt < 0.0f ? 0.0f : aws_kt;
    std::snprintf(payload, sizeof(payload), "IIMWV,%.1f,R,%.1f,N,A", a, s);
  }
  unsigned char cs = nmea_checksum(payload);
  return std::snprintf(out, out_len, "$%s*%02X\r\n", payload, cs);
}

}  // namespace wind_math
