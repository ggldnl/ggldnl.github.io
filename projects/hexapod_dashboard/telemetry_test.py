import asyncio
import json
import math
import time
import websockets


HOST = "0.0.0.0"
PORT = 8765

# Joint names
JOINT_NAMES = [
    "coxa_joint_1",
    "femur_joint_1",
    "tibia_joint_1",
    "coxa_joint_2",
    "femur_joint_2",
    "tibia_joint_2",
    "coxa_joint_3",
    "femur_joint_3",
    "tibia_joint_3",
    "coxa_joint_4",
    "femur_joint_4",
    "tibia_joint_4",
    "coxa_joint_5",
    "femur_joint_5",
    "tibia_joint_5",
    "coxa_joint_6",
    "femur_joint_6",
    "tibia_joint_6",
]

UPDATE_HZ = 50.0

class TelemetrySource:
    def __init__(self):
        self.start_time = time.time()

    def sample(self):
        t = time.time() - self.start_time

        telemetry = {
            "voltage": 12.0 + 0.3 * math.sin(t * 0.5),
            "current": 2.5 + 0.4 * math.sin(t * 1.2),
            "joints": {}
        }

        for i, name in enumerate(JOINT_NAMES):
            phase = i * (2 * math.pi / len(JOINT_NAMES))
            telemetry["joints"][name] = 30.0 * math.sin(t + phase)

        return telemetry


telemetry_source = TelemetrySource()

async def handle_client(websocket):
    print("Client connected")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue

            if data.get("command") == "get_telemetry":
                payload = telemetry_source.sample()
                await websocket.send(json.dumps(payload))

    except websockets.ConnectionClosed:
        pass
    finally:
        print("Client disconnected")


async def main():
    print(f"Starting telemetry server on ws://{HOST}:{PORT}")
    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
