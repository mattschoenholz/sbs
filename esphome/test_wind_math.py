"""
test_wind_math.py — test suite for wind_math.

Runs under either pytest (canonical) or stdlib unittest with no dependencies:
    cd esphome && pytest -v test_wind_math.py
    cd esphome && python3 -m unittest -v test_wind_math
"""

import math
import unittest
from math import cos, isnan, radians, sin

from wind_math import (
    WindCal,
    compute_awa,
    compute_aws_from_pulses,
    format_mwv_sentence,
    nmea_checksum,
)


# ── helpers ──────────────────────────────────────────────────────────────────


def synth_raw(angle_deg: float, cal: WindCal) -> tuple[float, float]:
    """Inverse of compute_awa — synthesize ADS1115 readings for a given angle."""
    a = radians(angle_deg - cal.heading_offset)
    raw_cos = cos(a) * cal.cos_gain + cal.cos_offset
    raw_sin = sin(a) * cal.sin_gain + cal.sin_offset
    return raw_cos, raw_sin


def angle_close(a: float, b: float, tol: float = 0.5) -> bool:
    """Compare two angles modulo 360 within a tolerance in degrees."""
    d = (a - b + 540.0) % 360.0 - 180.0
    return abs(d) < tol


# ── tests ────────────────────────────────────────────────────────────────────


class AwaTests(unittest.TestCase):
    def test_cardinal_angles_within_half_degree(self):
        cal = WindCal()
        for angle in (0.0, 90.0, 180.0, 270.0):
            with self.subTest(angle=angle):
                raw_cos, raw_sin = synth_raw(angle, cal)
                out = compute_awa(raw_cos, raw_sin, cal)
                self.assertTrue(
                    angle_close(out, angle, tol=0.5),
                    f"AWA({angle}°) returned {out:.3f}°, off by more than 0.5°",
                )

    def test_heading_offset_rotates_correctly(self):
        cal_zero = WindCal(heading_offset=0.0)
        cal_off = WindCal(heading_offset=45.0)
        raw_cos, raw_sin = synth_raw(0.0, cal_off)
        out_with = compute_awa(raw_cos, raw_sin, cal_off)
        self.assertTrue(angle_close(out_with, 0.0, tol=0.5))
        out_no = compute_awa(raw_cos, raw_sin, cal_zero)
        # Without the offset, the same raws read as -45° → 315° wrapped.
        self.assertTrue(angle_close(out_no, 315.0, tol=0.5))

    def test_swapped_sin_cos_does_not_crash_and_is_detectably_wrong(self):
        cal = WindCal()
        raw_cos, raw_sin = synth_raw(30.0, cal)
        correct = compute_awa(raw_cos, raw_sin, cal)
        swapped = compute_awa(raw_sin, raw_cos, cal)
        self.assertFalse(isnan(swapped), "sin/cos swap should not produce NaN")
        self.assertFalse(
            angle_close(correct, swapped, tol=10.0),
            f"Swap should yield a clearly different angle; got {correct}° vs {swapped}°",
        )

    def test_nan_input_returns_nan(self):
        cal = WindCal()
        self.assertTrue(isnan(compute_awa(float("nan"), 4.10, cal)))
        self.assertTrue(isnan(compute_awa(4.05, float("nan"), cal)))

    def test_at_offset_returns_nan(self):
        cal = WindCal()
        # Both readings at offset → atan2(0,0) is undefined; we return NaN.
        self.assertTrue(isnan(compute_awa(cal.cos_offset, cal.sin_offset, cal)))


class AwsTests(unittest.TestCase):
    def test_known_pulse_count(self):
        cal = WindCal(knots_per_hz=1.04)
        out = compute_aws_from_pulses(10, 1.0, cal)
        self.assertTrue(math.isclose(out, 10.4, rel_tol=1e-9))
        out = compute_aws_from_pulses(50, 5.0, cal)
        self.assertTrue(math.isclose(out, 10.4, rel_tol=1e-9))

    def test_zero_pulses(self):
        self.assertEqual(compute_aws_from_pulses(0, 1.0, WindCal()), 0.0)

    def test_zero_or_negative_window_returns_nan(self):
        cal = WindCal()
        self.assertTrue(isnan(compute_aws_from_pulses(5, 0.0, cal)))
        self.assertTrue(isnan(compute_aws_from_pulses(5, -1.0, cal)))


class NmeaTests(unittest.TestCase):
    def test_checksum_matches_xor(self):
        payload = "IIMWV,225.3,R,8.4,N,A"
        expected = 0
        for ch in payload.encode("ascii"):
            expected ^= ch
        self.assertEqual(nmea_checksum(payload), expected)

    def test_checksum_invalid_sentence_known_value(self):
        # Verified by hand: XOR of bytes in "IIMWV,,R,,N,V" = 0x2A
        self.assertEqual(nmea_checksum("IIMWV,,R,,N,V"), 0x2A)

    def test_mwv_sentence_format_matches_reference(self):
        out = format_mwv_sentence(225.3, 8.4, valid=True)
        payload = "IIMWV,225.3,R,8.4,N,A"
        cs = nmea_checksum(payload)
        expected = f"${payload}*{cs:02X}\r\n"
        self.assertEqual(out, expected)

    def test_mwv_with_nan_produces_v_flag(self):
        out = format_mwv_sentence(float("nan"), 8.4, valid=True)
        self.assertTrue(out.startswith("$IIMWV,,R,,N,V*"), out)
        self.assertTrue(out.endswith("\r\n"))
        out2 = format_mwv_sentence(180.0, float("nan"), valid=True)
        self.assertTrue(out2.startswith("$IIMWV,,R,,N,V*"))

    def test_mwv_with_valid_false_produces_v_flag(self):
        out = format_mwv_sentence(180.0, 5.0, valid=False)
        self.assertTrue(out.startswith("$IIMWV,,R,,N,V*"))

    def test_mwv_normalises_angle_modulo_360(self):
        self.assertIn("IIMWV,1.0,", format_mwv_sentence(361.0, 5.0))
        self.assertIn("IIMWV,359.0,", format_mwv_sentence(-1.0, 5.0))

    def test_mwv_clamps_negative_speed_to_zero(self):
        self.assertIn(",0.0,N,A*", format_mwv_sentence(180.0, -3.0))


if __name__ == "__main__":
    unittest.main(verbosity=2)
