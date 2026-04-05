#!/usr/bin/env python3
"""
imu_heading.py — ICM-20948 tilt-compensated magnetic heading → SignalK

Reads magnetometer + accelerometer from the ICM-20948 on the MacArthur HAT,
computes tilt-compensated magnetic heading, and sends $HCHDM NMEA sentences
to SignalK's TCP NMEA input on port 10110.

Also outputs $IIXDR sentences for pitch and roll (useful for heel indicator).

Calibration:
  Hard-iron offsets are stored in /home/pi/imu_cal.json after running the
  calibration routine. To calibrate: rotate the boat slowly through 360° and
  the service collects min/max values automatically. Run:
    python3 /home/pi/imu_heading.py --calibrate
  to force a fresh calibration collection and save the result.

SignalK paths produced:
  navigation.headingMagnetic  (from $HCHDM)
  navigation.attitude         (pitch/roll from $IIXDR)
"""

import socket
import time
import math
import json
import os
import sys
import logging
import argparse

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('imu_heading')

try:
    import icm20948
except ImportError:
    log.error("icm20948 not installed — run: pip3 install icm20948 --break-system-packages")
    sys.exit(1)

# ── CONFIG ────────────────────────────────────────────────────────────────────
SIGNALK_HOST   = 'localhost'
SIGNALK_PORT   = 10110
UPDATE_HZ      = 5          # heading updates per second
CAL_FILE       = '/home/pi/imu_cal.json'
CAL_COLLECT_S  = 120        # seconds to collect calibration data

# ── NMEA ──────────────────────────────────────────────────────────────────────
def nmea(sentence: str) -> bytes:
    cs = 0
    for c in sentence:
        cs ^= ord(c)
    return f"${sentence}*{cs:02X}\r\n".encode()


# ── CALIBRATION ───────────────────────────────────────────────────────────────
def load_cal():
    """Load hard-iron offsets from file. Returns (ox, oy, oz) or (0,0,0)."""
    if os.path.exists(CAL_FILE):
        try:
            with open(CAL_FILE) as f:
                d = json.load(f)
            ox, oy, oz = d['ox'], d['oy'], d['oz']
            log.info(f"Calibration loaded: ox={ox:.1f} oy={oy:.1f} oz={oz:.1f}")
            return ox, oy, oz
        except Exception as e:
            log.warning(f"Could not load calibration: {e}")
    log.warning("No calibration file found — heading may be offset. Run with --calibrate when at the boat.")
    return 0.0, 0.0, 0.0


def save_cal(ox, oy, oz):
    with open(CAL_FILE, 'w') as f:
        json.dump({'ox': ox, 'oy': oy, 'oz': oz}, f)
    log.info(f"Calibration saved: ox={ox:.1f} oy={oy:.1f} oz={oz:.1f}")


def run_calibration(imu):
    """
    Collect magnetometer min/max over CAL_COLLECT_S seconds.
    Motor or sail the boat through at least 360° during this time.
    Saves hard-iron offsets to CAL_FILE.
    """
    log.info(f"=== CALIBRATION MODE ===")
    log.info(f"Rotate the boat slowly through 360°+ over the next {CAL_COLLECT_S}s")
    log.info("Press Ctrl+C to stop early and save what was collected")

    mx_min = my_min = mz_min =  1e9
    mx_max = my_max = mz_max = -1e9
    start = time.time()

    try:
        while time.time() - start < CAL_COLLECT_S:
            _, _, _, mx, my, mz = imu.read_magnetometer_data() if hasattr(imu, 'read_magnetometer_data') else (0,0,0,0,0,0)
            try:
                mx, my, mz = imu.read_magnetometer_data()
            except Exception:
                ax, ay, az, gx, gy, gz = imu.read_accelerometer_gyro_data()
                mx, my, mz = 0, 0, 0

            mx_min = min(mx_min, mx); mx_max = max(mx_max, mx)
            my_min = min(my_min, my); my_max = max(my_max, my)
            mz_min = min(mz_min, mz); mz_max = max(mz_max, mz)

            elapsed = time.time() - start
            print(f"\r  {elapsed:.0f}s  mx=[{mx_min:.0f},{mx_max:.0f}] my=[{my_min:.0f},{my_max:.0f}]", end='', flush=True)
            time.sleep(0.1)
    except KeyboardInterrupt:
        pass

    print()
    ox = (mx_max + mx_min) / 2
    oy = (my_max + my_min) / 2
    oz = (mz_max + mz_min) / 2
    save_cal(ox, oy, oz)
    log.info("Calibration complete.")


# ── HEADING MATH ──────────────────────────────────────────────────────────────
def tilt_compensated_heading(ax, ay, az, mx, my, mz, ox, oy, oz):
    """
    Compute tilt-compensated magnetic heading in degrees [0, 360).
    Applies hard-iron offsets (ox, oy, oz) before computing.
    """
    # Apply hard-iron calibration
    mx -= ox; my -= oy; mz -= oz

    # Roll and pitch from accelerometer (radians)
    roll  = math.atan2(ay, az)
    pitch = math.atan2(-ax, math.sqrt(ay * ay + az * az))

    # Tilt-compensated magnetic components
    Xh = mx * math.cos(pitch) + mz * math.sin(pitch)
    Yh = (mx * math.sin(roll) * math.sin(pitch)
          + my * math.cos(roll)
          - mz * math.sin(roll) * math.cos(pitch))

    heading = math.degrees(math.atan2(-Yh, Xh)) % 360
    return heading, math.degrees(roll), math.degrees(pitch)


# ── SIGNALK TCP ───────────────────────────────────────────────────────────────
def connect():
    while True:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.connect((SIGNALK_HOST, SIGNALK_PORT))
            log.info(f"Connected to SignalK NMEA TCP {SIGNALK_HOST}:{SIGNALK_PORT}")
            return s
        except OSError as e:
            log.warning(f"SignalK TCP connect failed: {e} — retrying in 5s")
            time.sleep(5)


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--calibrate', action='store_true',
                        help='Run calibration routine and save offsets')
    args = parser.parse_args()

    log.info("Initialising ICM-20948...")
    try:
        imu = icm20948.ICM20948()
    except Exception as e:
        log.error(f"ICM-20948 init failed: {e}")
        sys.exit(1)
    log.info("ICM-20948 ready")

    if args.calibrate:
        run_calibration(imu)
        return

    ox, oy, oz = load_cal()
    sock = connect()
    interval = 1.0 / UPDATE_HZ
    err_count = 0

    while True:
        loop_start = time.monotonic()
        try:
            ax, ay, az, _, _, _ = imu.read_accelerometer_gyro_data()
            mx, my, mz          = imu.read_magnetometer_data()

            heading, roll, pitch = tilt_compensated_heading(
                ax, ay, az, mx, my, mz, ox, oy, oz)

            sentences = [
                nmea(f"HCHDM,{heading:.1f},M"),
                nmea(f"IIXDR,A,{pitch:.1f},D,Pitch,A,{roll:.1f},D,Roll"),
            ]

            for s in sentences:
                try:
                    sock.sendall(s)
                except OSError:
                    log.warning("SignalK connection lost — reconnecting")
                    sock.close()
                    sock = connect()
                    sock.sendall(s)

            err_count = 0

        except Exception as e:
            err_count += 1
            log.warning(f"IMU read error ({err_count}): {e}")
            if err_count > 10:
                log.error("Too many IMU errors — exiting")
                sys.exit(1)
            time.sleep(1)
            continue

        elapsed = time.monotonic() - loop_start
        sleep_time = interval - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)


if __name__ == '__main__':
    main()
