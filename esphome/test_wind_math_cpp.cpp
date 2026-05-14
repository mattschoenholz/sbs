// test_wind_math_cpp.cpp — parity harness: emits CSV of C++ outputs for the
// same fixtures the Python tests cover. test_wind_math_parity.py compares
// the CSV against wind_math.py outputs.
//
// Build:
//   g++ -std=c++17 -O2 -o test_wind_math_cpp test_wind_math_cpp.cpp
// Run:
//   ./test_wind_math_cpp > parity.csv

#include <cmath>
#include <cstdio>
#include <initializer_list>

#include "wind_math.h"

using wind_math::WindCal;
using wind_math::compute_awa;
using wind_math::compute_aws_from_pulses;
using wind_math::format_mwv_sentence;
using wind_math::nmea_checksum;

static void emit_awa(const char *label, float raw_cos, float raw_sin,
                     const WindCal &cal) {
  float v = compute_awa(raw_cos, raw_sin, cal);
  std::printf("AWA,%s,%.6f,%.6f,%.6f\n", label, raw_cos, raw_sin, v);
}

static void emit_aws(const char *label, int pulses, float window,
                     const WindCal &cal) {
  float v = compute_aws_from_pulses(pulses, window, cal);
  std::printf("AWS,%s,%d,%.6f,%.6f\n", label, pulses, window, v);
}

static void emit_mwv(const char *label, float awa, float aws, bool valid) {
  char buf[80];
  format_mwv_sentence(awa, aws, valid, buf, sizeof(buf));
  // Strip the trailing \r\n for CSV cleanliness.
  for (char *p = buf; *p; ++p) if (*p == '\r' || *p == '\n') { *p = 0; break; }
  std::printf("MWV,%s,%.3f,%.3f,%d,%s\n", label, awa, aws, valid ? 1 : 0, buf);
}

int main() {
  WindCal cal_default;
  WindCal cal_off;
  cal_off.heading_offset = 45.0f;
  WindCal cal_kts;
  cal_kts.knots_per_hz = 1.04f;

  // Cardinal angles synthesised in the same way as the Python helper.
  for (float angle : {0.0f, 90.0f, 180.0f, 270.0f, 30.0f, 225.3f}) {
    float a = (angle - cal_default.heading_offset) * static_cast<float>(M_PI) / 180.0f;
    float raw_cos = std::cos(a) * cal_default.cos_gain + cal_default.cos_offset;
    float raw_sin = std::sin(a) * cal_default.sin_gain + cal_default.sin_offset;
    char label[32];
    std::snprintf(label, sizeof(label), "card_%.1f", angle);
    emit_awa(label, raw_cos, raw_sin, cal_default);
  }

  // NaN propagation
  emit_awa("nan_cos", NAN, 4.10f, cal_default);
  emit_awa("nan_sin", 4.05f, NAN, cal_default);
  emit_awa("at_offset", cal_default.cos_offset, cal_default.sin_offset, cal_default);

  // AWS fixtures
  emit_aws("10pulses_1s", 10, 1.0f, cal_kts);
  emit_aws("50pulses_5s", 50, 5.0f, cal_kts);
  emit_aws("zero_pulses", 0, 1.0f, cal_kts);
  emit_aws("zero_window", 5, 0.0f, cal_kts);
  emit_aws("neg_window", 5, -1.0f, cal_kts);

  // MWV fixtures (verbatim NMEA payload comparison)
  emit_mwv("normal", 225.3f, 8.4f, true);
  emit_mwv("nan_angle", NAN, 8.4f, true);
  emit_mwv("nan_speed", 180.0f, NAN, true);
  emit_mwv("invalid_flag", 180.0f, 5.0f, false);
  emit_mwv("wrap_pos", 361.0f, 5.0f, true);
  emit_mwv("wrap_neg", -1.0f, 5.0f, true);
  emit_mwv("clamp_neg_speed", 180.0f, -3.0f, true);

  // Checksum spot-checks
  std::printf("CKSUM,IIMWV_normal,%02X\n", nmea_checksum("IIMWV,225.3,R,8.4,N,A"));
  std::printf("CKSUM,IIMWV_invalid,%02X\n", nmea_checksum("IIMWV,,R,,N,V"));
  return 0;
}
