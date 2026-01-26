import websockets
import asyncio
import random
import json


HOST = "0.0.0.0"
PORT = 8765

# Joint names
JOINT_NAMES = [
    elem.format(i) 
        for i in range(1, 7) 
            for elem in ['leg_{}_coxa', 'leg_{}_femur', 'leg_{}_tibia']
]

# Voltage and current
VOLTAGE = 6.1
CURRENT = 3

EPS = 0.01
INCR = 0.1


async def handle_client(websocket):
    print("Client connected")

    current_volts = VOLTAGE
    current_amps = CURRENT

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue

            if data.get("command") == "get_telemetry":
                
                payload = {}

                # Add static joint values
                payload["joints"] = {}
                for joint in JOINT_NAMES:
                    if "tibia" in joint:
                        payload["joints"][joint] = -45
                    elif "femur" in joint:
                        payload["joints"][joint] = 45
                    else:
                        payload["joints"][joint] = 0
                
                # Simulate voltage and current fluctuations
                rnd = random.random()
                if rnd < 0.01:  # 1% probability for a fluctuation
                    
                    rnd = random.random()
                    if rnd < 0.5:
                        current_volts = VOLTAGE - random.random() * 0.5  # +/- 0.5V
                    else:
                        current_amps = CURRENT - random.random() * 1  # +/- 1A

                # Slowly catch up the target values
                voltage_diff = VOLTAGE - current_volts
                if abs(voltage_diff) > EPS and current_volts + INCR < VOLTAGE:
                    current_volts += INCR
                else:
                    current_volts = VOLTAGE

                current_diff = CURRENT - current_amps
                if abs(current_diff) > EPS and current_amps + INCR < CURRENT:
                    current_amps += INCR
                else:
                    current_amps = CURRENT

                # Add voltage and current to the payload
                payload['voltage'] = current_volts
                payload['current'] = current_amps

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
