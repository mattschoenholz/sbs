"""
wind_math.py — host-testable wind sensor math for SV-Esperanza ST60 transducer.

Mirrors the C++ implementation in wind_math.h / wind_math.cpp; the Python module
is the source of truth for unit tests. Both implementations must produce identical
output for the same inputs (parity test in tests/parity).

Conventions:
    * Voltages are float volts as read by ADS1115 (gain=2/3, FSR ±6.144V).
    * Angles are degrees, 0..360, measured clockwise from boat centerline.
    * AWS in knots.
    * NaN outputs and the "V" status flag mark "data invalid" frames.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import atan2, degrees, isnan


# Bench-calibrated factory defaults from 2026-04-25 dock test.
# See intel_vault: 02_Boat_Project/ST60 Wind Transducer ESP32.md (Phase 3).
FACTORY_COS_OFFSET   = 4.05
FACTORY_COS_GAIN     = 1.75
FACTORY_SIN_OFFSET   = 4.10
FACTORY_SIN_GAIN     = 1.80
FACTORY_HEADING_OFFSET = 0.0
FACTORY_KNOTS_PER_HZ = 1.04


@dataclass
class WindCal:
    """Calibration constants — persisted in ESP32 NVS via ESPHome globals."""
    cos_offset:     float = FACTORY_COS_OFFSET
    cos_gain:       float = FACTORY_COS_GAIN
    sin_offset:     float = FACTORY_SIN_OFFSET
    sin_gain:       float = FACTORY_SIN_GAIN
    heading_offset: float = FACTORY_HEADING_OFFSET
    knots_per_hz:   float = FACTORY_KNOTS_PER_HZ


def compute_awa(raw_cos: float, raw_sin: float, cal: WindCal) -> float:
    """Apparent wind angle in degrees [0, 360).

    Returns NaN if either reading is NaN, or if both normalised components
    are zero (vane signal absent — atan2(0,0) is undefined).
    """
    if isnan(raw_cos) or isnan(raw_sin):
        return float("nan")
    cos_v = (raw_cos - cal.cos_offset) / cal.cos_gain
    sin_v = (raw_sin - cal.sin_offset) / cal.sin_gain
    if cos_v == 0.0 and sin_v == 0.0:
        return float("nan")
    angle_deg = degrees(atan2(sin_v, cos_v))
    return (angle_deg + cal.heading_offset) % 360.0


def compute_aws_from_pulses(pulse_count: int, time_window_sec: float, cal: WindCal) -> float:
    """Apparent wind speed in knots, from pulse count over a time window.

    Returns NaN if the window is non-positive (avoids divide-by-zero).
    """
    if time_window_sec <= 0:
        return float("nan")
    hz = pulse_count / time_window_sec
    return hz * cal.knots_per_hz


def nmea_checksum(payload: str) -> int:
    """NMEA 0183 checksum: XOR of all bytes between '$' and '*' exclusive.

    `payload` must NOT contain the leading '$' or trailing '*<cs>'.
    """
    cs = 0
    for ch in payload.encode("ascii"):
        cs ^= ch
    return cs


def format_mwv_sentence(awa_deg: float, aws_kt: float, valid: bool = True) -> str:
    """Build a complete `$IIMWV,...*cs\\r\\n` apparent-wind sentence.

    NMEA 0183 MWV (Wind Speed and Angle), Talker `II` (integrated instr.):
        $IIMWV,<angle>,R,<speed>,N,<status>*<cs>\\r\\n

    R = relative (apparent), N = knots.
    Status: 'A' = data valid, 'V' = data invalid.

    NaN inputs always force `V` and emit empty angle/speed fields.
    """
    nan_in = isnan(awa_deg) or isnan(aws_kt)
    if nan_in or not valid:
        payload = "IIMWV,,R,,N,V"
    else:
        # Normalize angle to [0, 360); ESPHome lambdas may pass slightly OOB values.
        a = awa_deg % 360.0
        s = max(0.0, aws_kt)
        payload = f"IIMWV,{a:.1f},R,{s:.1f},N,A"
    cs = nmea_checksum(payload)
    return f"${payload}*{cs:02X}\r\n"
