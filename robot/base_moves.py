# Canopy Keepers - Robot Game base moves for LEGO SPIKE Prime (SPIKE App 3, Python)
#
# What this gives you:
#   straight(cm)      drive straight using the gyro, slows down at the end
#   turn(deg)         spin on the spot to an exact angle using the gyro
#   arm(port, deg)    move an attachment motor
#
# Setup (change these to match YOUR robot):
#   - Drive motors on ports A (left) and B (right)
#   - Wheel: 56 mm SPIKE wheel  -> WHEEL_CM = 17.6 (distance travelled per turn)
#   - Attachment motors on C and D
# First test: run straight(50). Measure with a ruler. If it goes 48 cm, set
# WHEEL_CM = 17.6 * 48 / 50. If turn(90) turns the wrong way, set TURN_SIGN = -1.

from hub import port, motion_sensor, light_matrix, button
import motor, motor_pair, runloop

LEFT, RIGHT = port.A, port.B
WHEEL_CM = 17.6          # cm per wheel turn (calibrate!)
TURN_SIGN = 1            # flip to -1 if turns go the wrong way
KP_STRAIGHT = 2.0        # how hard the robot corrects drift while driving
KP_TURN = 3.0            # how fast the robot turns for a given error
PAIR = motor_pair.PAIR_1

motor_pair.pair(PAIR, LEFT, RIGHT)


def yaw():
    # tilt_angles() gives tenths of a degree; yaw is the first value
    return TURN_SIGN * motion_sensor.tilt_angles()[0] / 10


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def travelled_cm():
    # average of both wheels; the left motor is mirrored so we flip it
    deg = (abs(motor.relative_position(LEFT)) + abs(motor.relative_position(RIGHT))) / 2
    return deg / 360 * WHEEL_CM


async def straight(cm, speed=600, heading=None):
    """Drive cm centimetres (negative = backwards) holding a gyro heading."""
    target = yaw() if heading is None else heading
    motor.reset_relative_position(LEFT, 0)
    motor.reset_relative_position(RIGHT, 0)
    direction = 1 if cm >= 0 else -1
    goal = abs(cm)
    while travelled_cm() < goal:
        left = goal - travelled_cm()
        v = speed if left > 10 else max(150, speed * left / 10)   # slow for the last 10 cm
        error = target - yaw()
        steer = clamp(int(KP_STRAIGHT * error) * direction, -100, 100)
        motor_pair.move(PAIR, -steer, velocity=int(v * direction))
        await runloop.sleep_ms(10)
    motor_pair.stop(PAIR, stop=motor.BRAKE)
    await runloop.sleep_ms(100)


async def turn(deg, max_speed=400):
    """Turn to (current heading + deg). Positive = right."""
    target = yaw() + deg
    while True:
        error = target - yaw()
        if abs(error) < 1:
            break
        v = clamp(int(KP_TURN * error * 10), -max_speed, max_speed)
        if abs(v) < 80:
            v = 80 if v > 0 else -80          # minimum push so it doesn't stall
        motor_pair.move_tank(PAIR, v, -v)
        await runloop.sleep_ms(10)
    motor_pair.stop(PAIR, stop=motor.BRAKE)
    await runloop.sleep_ms(150)


async def arm(p, degrees, speed=500):
    """Move an attachment motor by degrees."""
    await motor.run_for_degrees(p, degrees, speed)


async def wait_for_start():
    light_matrix.write("GO")
    while not button.pressed(button.LEFT):
        await runloop.sleep_ms(20)
    light_matrix.clear()


async def main():
    motion_sensor.reset_yaw(0)
    await runloop.sleep_ms(300)        # let the gyro settle; keep the robot still
    await wait_for_start()

    # ---- Test run: a 50 cm square. Use this to calibrate. ----
    for _ in range(4):
        await straight(50)
        await turn(90)

    # ---- Example mission run (edit for real missions) ----
    # await straight(35)
    # await turn(-45)
    # await arm(port.C, 120)
    # await straight(-35)


runloop.run(main())
