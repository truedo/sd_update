import os
import time
import serial
import struct
import hashlib

PORT = "COM4"  # TinyUSB 시리얼 포트 설정
BAUD_RATE = 921600
BUFFER_SIZE = 256
FOLDER_TO_SEND = "sd_update_files" # PC에서 SD 카드로 전송할 폴더


def calculate_md5(file_path):
    """파일의 MD5 해시 계산"""
    md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        while chunk := f.read(4096):
            md5.update(chunk)
    return md5.hexdigest()

def send_file(ser, file_path, relative_path, send_file_index):
    """ESP32로 파일을 전송"""
    file_size = os.path.getsize(file_path)
        
    #print(f"전송 시작: {relative_path} ({file_size / 1024:.2f} KB)")
    print(f"{send_file_index} 전송 : {relative_path} ({file_size} 바이트)")
        
    # 1. 파일 경로 길이 및 데이터 전송
    path_length = len(relative_path)
    ser.write(struct.pack("<I", path_length))
    time.sleep(0.1)
    
    #ser.write(relative_path.encode("utf-8"))
    converted_path = relative_path.replace("\\", "/")  # 백슬래시를 슬래시로 변환
    ser.write(converted_path.encode("utf-8"))
    time.sleep(0.1)

    # 2. 파일 크기 전송
    ser.write(struct.pack("<I", file_size))
    time.sleep(0.3)
    
    com_success = False
    while not (com_success):

        # 3. 파일 데이터 전송
        total_bytes_sent = 0
        start_time = time.time()
        last_printed_percent = 0
        total_bytes_sent = 0
        with open(file_path, "rb") as f:
            while chunk := f.read(BUFFER_SIZE):
                ser.write(chunk)
                #time.sleep(0.0001)
                time.sleep(0.0001)            
                
                ser.flush()  # 데이터 즉시 전송
                total_bytes_sent += len(chunk)
                
                percent = (total_bytes_sent / file_size) * 100
               
        print("완료!")

        
        # 4. ESP32로부터 ACK 수신
        ack = ser.read(1)
        #print(f"{ack} ack")
        if ack == b'\xe1':
            print("✅ 파일 전송 성공")
            com_success = True
        #else:
        #   print("❌ 파일 전송 실패")
        elif ack == b'\xe2':
            print("❌ 파일 바이트 부족 ")
            print("❗재전송 ")
            time.sleep(0.3)
        elif ack == b'\xe3':
            print("❌ 파일 바이트 다름 ")
            print("❗재전송 ")
            time.sleep(0.3)
        
    # 수신 시간 및 속도 계산
    transfer_time = time.time() - start_time
    transfer_speed = (total_bytes_sent / transfer_time) if transfer_time > 0 else 0

    print(f"소요 시간: {transfer_time:.2f} sec")
    print(f"총 수신 데이터: {total_bytes_sent / 1000} KB")
    print(f"초당 전송 속도: {transfer_speed / 1000:.2f} KB/s\n")

    time.sleep(0.1)
                

def validate_files(serial_port, folder_path):
    """ESP32에 저장된 파일 검증 (MD5 체크섬 비교)"""
    print("🔍 파일 무결성 검증 시작")
    start_all_time =  time.time()

    files = []
    for root, _, filenames in os.walk(folder_path):
        for filename in filenames:
            full_path = os.path.join(root, filename)
            relative_path = os.path.relpath(full_path, folder_path)
            files.append((full_path, relative_path))
            
    total_files= len(files)
    print(f"총 {total_files}개의 파일 검증을 시작합니다.")

    start_all_time = time.time()

    with serial.Serial(serial_port, BAUD_RATE, timeout=3) as ser:
        ser.write(b'\xcc')  # 검증 모드 신호
        time.sleep(0.1)
        
        # 0. 파일 개수 전송
        ser.write(struct.pack("<I", total_files))
        time.sleep(0.1)

        send_file_index = 0
        
        for root, _, filenames in os.walk(folder_path):
            for filename in filenames:
                
                full_path = os.path.join(root, filename)
                relative_path = os.path.relpath(full_path, folder_path)

                send_file_index += 1
                
                # 1. 파일 경로 길이 및 데이터 전송
                path_length = len(relative_path)
                ser.write(struct.pack("<I", path_length))
                time.sleep(0.1)

                converted_path = relative_path.replace("\\", "/")  # 백슬래시를 슬래시로 변환
                ser.write(converted_path.encode("utf-8"))
                time.sleep(0.1)

                # 2. 파일 크기 전송
                file_size = os.path.getsize(full_path)
                ser.write(struct.pack("<I", file_size))
                time.sleep(0.3)


                # 2. ESP32로부터 MD5 체크섬 수신 : 에러인지 확인
                #checksum_bytes = ser.read(32).decode("utf-8").strip()
                #if checksum_bytes == "ERROR":

                ack = ser.read(1)
                #print(f"{ack} ack")
                if ack == b'\xe1':
                    print(f"✅ {send_file_index} 검증 완료: {relative_path}")

                else:
                    print(f"❌ {send_file_index} 검증 실패: {relative_path}")
                    
                    if ack == b'\xe3':
                         print(f"열수 없음")

                    elif ack == b'\xe2':
                         print(f"크기 다름")                    
                                                         
                                    
                    time.sleep(0.1)
                    
                    ser.write(b'\xee')  # 전송 시작 신호
                    time.sleep(0.1)    

                    ser.write(struct.pack("<I", 1)) # 파일 갯수
                    time.sleep(0.1)
                    
                    send_file(ser, full_path, relative_path, send_file_index)
                    time.sleep(0.1)

                    ser.write(b'\xcc')  # 검증 모드 신호
                    time.sleep(0.1)                    

                    ser.write(struct.pack("<I", total_files - send_file_index))
                    time.sleep(0.1)
                        


    print("🔍 전체 파일 검증 완료!")

    transfer_all_time = time.time() - start_all_time
    print(f"소요 시간: {transfer_all_time:.2f} sec")
    minutes = int(transfer_all_time // 60)
    seconds = int(transfer_all_time % 60)
    print(f"총 소요 시간: {minutes}분 {seconds}초")


if __name__ == "__main__":

    # 폴더 검증 및 없는 파일 전송
    validate_files(PORT, FOLDER_TO_SEND)



    
