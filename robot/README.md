# Robot Game code (SPIKE Prime)

`base_moves.py` is the starting code for every Robot Game run. Open the SPIKE App (version 3), make a new **Python** project, paste the file in, and press Play. The hub shows **GO**: press the left button to start.

## What it does
- `straight(cm)` drives straight and uses the gyro to stay on line. It slows down for the last 10 cm so it stops in the same place every time.
- `turn(deg)` spins to an exact angle using the gyro. Positive numbers turn right.
- `arm(port, deg)` moves an attachment motor.

## Calibrate once (10 minutes)
1. Put the drive motors on ports **A (left)** and **B (right)**.
2. Run the program. It drives a 50 cm square.
3. Measure one side with a ruler. If it went 48 cm, change `WHEEL_CM` to `17.6 * 48 / 50`.
4. If the robot turns the wrong way, set `TURN_SIGN = -1`.
5. If it wobbles while driving, lower `KP_STRAIGHT`. If it drifts, raise it.
6. Keep the robot still for the first second, while the gyro settles.

Write each change and why in the Engineering Notebook. Judges like seeing that you tested and improved the robot.

Not yet tested on the team's robot, so check every number on the real build.
