"""
test_wind_math_parity.py — verify the C++ port of wind_math produces identical
output to the Python reference for a fixed fixture set.

Builds test_wind_math_cpp.cpp with g++, runs it, parses the CSV, and asserts
each row matches the Python implementation within float tolerance.

    cd esphome && python3 -m unittest -v test_wind_math_parity
"""

import math
import os
import shutil
import subprocess
import unittest

from wind_math import (
    WindCal,
    compute_awa,
    compute_aws_from_pulses,
    format_mwv_sentence,
    nmea_checksum,
)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "test_wind_math_cpp.cpp")
BIN = os.path.join(HERE, "test_wind_math_cpp.bin")


def _build_and_run() -> list[list[str]]:
    cxx = shutil.which("g++") or shutil.which("clang++")
    if not cxx:
        raise unittest.SkipTest("no C++ compiler on PATH (need g++ or clang++)")
    subprocess.run(
        [cxx, "-std=c++17", "-O2", "-Wall", "-Wextra", SRC, "-o", BIN],
        check=True,
        cwd=HERE,
    )
    out = subprocess.run([BIN], capture_output=True, check=True, text=True).stdout
    # Limit to 5 splits because MWV rows contain commas inside the NMEA sentence.
    return [line.split(",", 5) for line in out.strip().splitlines()]


def _close(a: float, b: float, tol: float = 1e-3) -> bool:
    if math.isnan(a) and math.isnan(b):
        return True
    if math.isnan(a) or math.isnan(b):
        return False
    return abs(a - b) <= tol


class CppParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = _build_and_run()

    def _rows_of_type(self, kind: str):
        return [r for r in self.rows if r and r[0] == kind]

    def test_awa_parity(self):
        cal = WindCal()
        for row in self._rows_of_type("AWA"):
            _, label, raw_cos, raw_sin, cpp_v = row
            py_v = compute_awa(float(raw_cos), float(raw_sin), cal)
            self.assertTrue(
                _close(py_v, float(cpp_v), tol=1e-3),
                f"AWA mismatch [{label}]: py={py_v} cpp={cpp_v}",
            )

    def test_aws_parity(self):
        cal = WindCal(knots_per_hz=1.04)
        for row in self._rows_of_type("AWS"):
            _, label, pulses, window, cpp_v = row
            py_v = compute_aws_from_pulses(int(pulses), float(window), cal)
            self.assertTrue(
                _close(py_v, float(cpp_v), tol=1e-6),
                f"AWS mismatch [{label}]: py={py_v} cpp={cpp_v}",
            )

    def test_mwv_parity(self):
        for row in self._rows_of_type("MWV"):
            _, label, awa, aws, valid_str, cpp_sentence = row
            awa_f = float(awa)
            aws_f = float(aws)
            valid = bool(int(valid_str))
            py_sentence = format_mwv_sentence(awa_f, aws_f, valid).rstrip("\r\n")
            self.assertEqual(
                py_sentence,
                cpp_sentence,
                f"MWV mismatch [{label}]: py={py_sentence!r} cpp={cpp_sentence!r}",
            )

    def test_checksum_parity(self):
        cs_rows = {r[1]: int(r[2], 16) for r in self._rows_of_type("CKSUM")}
        self.assertEqual(cs_rows["IIMWV_normal"], nmea_checksum("IIMWV,225.3,R,8.4,N,A"))
        self.assertEqual(cs_rows["IIMWV_invalid"], nmea_checksum("IIMWV,,R,,N,V"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
