const GITHUB_USER = "truedo";
const REPO_NAME = "sd_update";
const BRANCH = "main";
const BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/sd_update_files/`;

let port;
let writer;
let reader;
const BAUD_RATE = 921600;
const TIMEOUT = 3000; // ms

async function connectSerial() {
    try {        
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: BAUD_RATE });

        writer = port.writable.getWriter();
        reader = port.readable.getReader();

        console.log("✅ ESP32 연결 성공!");
    } catch (error) {
        console.error("❌ ESP32 연결 실패:", error);
    }
}

async function loadFileList() {
    try {
        const response = await fetch("files.json"); // 로컬 JSON 불러오기             
        const fileList = await response.json();
        const fullUrls = fileList.map(file => file);

        console.log("✅ 다운로드할 파일 목록:", fullUrls);
        console.log(`📂 총 ${fileList.length}개의 파일 발견`);

        return fullUrls;

    } catch (error) {
        console.error("❌ 파일 목록 로드 실패:", error);
        return [];
    }
}


const BUFFER_SIZE = 64; // 버퍼 크기 설정
const MAX_RETRIES = 3; // 최대 재전송 횟수

async function testSingleFileTransfer() 
{
    console.log("✅ ver 8");
    await connectSerial(); // ESP32 연결

    const fileList = await loadFileList();
    if (fileList.length === 0) {
        console.log("❌ 전송할 파일이 없습니다.");
        return;
    }

    const fileUrl = BASE_URL + fileList[0]; // 첫 번째 파일 가져오기
    const filePath = fileList[0]; // 상대 경로 유지

    console.log(`🚀 테스트 전송 시작: ${filePath}`);

    let retryCount = 0;
    let success = false;

    while (retryCount < MAX_RETRIES && !success) 
    {
        if (retryCount > 0) 
        {
            console.warn(`📌 재전송 시도: ${retryCount}/${MAX_RETRIES}`);
        }

        await writer.write(new Uint8Array([0xee]));   // 전송 시작 신호
        console.log("✔️ 전송 성공 [0xee] 파일 전송 시작 바이트");
        await new Promise(resolve => setTimeout(resolve, 100));

        await writer.write(new Uint8Array([0x01])); // 파일 개수 전송 (1개)
        console.log(`✔️ 전송 성공: 1 개의 파일`);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 파일 경로 길이 전송
        await writer.write(new Uint8Array(new Uint32Array([filePath.length]).buffer));
        console.log(`✔️ 전송 성공: ${filePath.length} 파일 길이`);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 파일 경로 데이터 전송
        await writer.write(new TextEncoder().encode(filePath));
        console.log(`✔️ 전송 성공: ${filePath} 파일 이름`);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 📌 파일 크기 확인 (서버 Content-Length)
        const response = await fetch(fileUrl);
        if (!response.ok) {
            console.error(`❌ 파일 다운로드 실패: ${fileUrl}`);
            return;
        }

        const contentLength = response.headers.get("Content-Length");
        if (contentLength) {
            console.log(`📏 서버 제공 파일 크기: ${contentLength} bytes`);
        }

        const fileData = await response.arrayBuffer();
        const fileSize = fileData.byteLength;

        console.log(`📥 다운로드한 파일 크기: ${fileSize} bytes`);
        if (contentLength && fileSize !== parseInt(contentLength)) {
            console.error("⚠️ 파일 크기 불일치! 네트워크 문제 가능성 있음.");
            return;
        }

        // 파일 크기 전송 (4바이트)
        await writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));
        console.log(`✔️ 전송 성공: ${fileSize} 바이트 파일 크기`);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 📌 파일 데이터 전송 (256 바이트씩 나누어 전송)
        let totalSent = 0;
        const fileArray = new Uint8Array(fileData);

        console.log(`📤 파일 전송 시작: ${filePath}`);
        for (let i = 0; i < fileSize; i += BUFFER_SIZE) {
            const chunk = fileArray.slice(i, i + BUFFER_SIZE);
            await writer.write(chunk);
            await new Promise(resolve => setTimeout(resolve, 1));
            totalSent += chunk.length;

            // 진행률 표시
            const percent = Math.round((totalSent / fileSize) * 100);
            console.log(`📊 진행률: ${percent}% (${totalSent}/${fileSize} bytes)`);
        }

        console.log(`✅ 전송 완료: ${filePath}`);

        // ESP32로부터 ACK 수신
        const { value } = await reader.read();
        const receivedByte = value[0]; 

        console.log(`📩 받은 ACK: 0x${receivedByte.toString(16).toUpperCase()}`); // hex 출력

        if (receivedByte === 0xE1) 
        { 
            console.log("✔️ 전송 성공");
            success = true;
        } else 
        {
            if (receivedByte === 0xE2) 
            {
                console.warn("❌ 파일 바이트 부족 - 재전송 필요");
            } 
            else if (receivedByte === 0xE3) 
            {
                console.warn("❌ 파일 바이트 다름 - 재전송 필요");
            } 
            else 
            {
                console.warn("❌ 알 수 없는 전송 오류 - 재전송 필요");
            }
            retryCount++;
        }
    }
    if (!success) 
        {
        console.error("❌ 파일 전송 실패: 최대 재전송 횟수 초과");
    }
}


async function sendFileToESP32(fileUrl, relativePath, index, totalFiles) 
{
    try {
        const response = await fetch(fileUrl);
        const fileData = await response.arrayBuffer();
        const fileSize = fileData.byteLength;

        console.log(`📤 전송 중: ${relativePath} (${fileSize} bytes)`);

        updateProgress(index, totalFiles, `전송 중: ${relativePath}`);

        // 1. 파일 경로 길이 전송
        await writer.write(new Uint8Array(new Uint32Array([relativePath.length]).buffer));
        console.log(`✔️ 전송 성공: ${relativePath.length} 파일 길이`);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 2. 파일 경로 전송
        await writer.write(new TextEncoder().encode(relativePath));
        console.log(`✔️ 전송 성공: ${relativePath} 파일 이름`);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 3. 파일 크기 전송
        await writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));
        console.log(`✔️ 전송 성공: ${fileSize} 파일 크기`);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 4. 파일 데이터 전송
        await writer.write(new Uint8Array(fileData));
        console.log(`✔️ 데이터 전송 시작`);
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log(`✅ 전송 완료: ${relativePath}`);

        // 5. ESP32로부터 ACK 수신
        const { value } = await reader.read();
        if (value === "\xe1") {
            console.log("✔️ 전송 성공");
            updateProgress(index + 1, totalFiles, `✅ 완료: ${relativePath}`);
            return true;
        } else {
            console.warn("❌ 전송 실패, 다시 시도");
            updateProgress(index, totalFiles, `⚠️ 실패: ${relativePath}`);
            return false;
        }
    } 
    catch (error) 
    {
        console.error(`❌ 파일 전송 오류: ${relativePath}`, error);
        updateProgress(index, totalFiles, `❌ 오류: ${relativePath}`);
        return false;
    }
}

async function validateFilesOnESP32() {
    try {  
        // 🔹 **검증 모드 신호 (0xCC) 정확하게 1바이트 전송**
        await writer.write(new Uint8Array([0xCC]));  
        console.log("✔️ 전송 성공 [0xCC] 검증 시작 바이트");
        await new Promise(resolve => setTimeout(resolve, 100)); // 작은 지연

        const fileList = await loadFileList();
        let failedFiles = [];

        // 0. 파일 개수 전송
        await writer.write(new Uint8Array(new Uint32Array([fileList.length]).buffer));
        console.log(`✔️ 전송 성공: ${fileList.length}개의 파일`);
        await new Promise(resolve => setTimeout(resolve, 100));

        let send_file_index = 0

        for (const filePath of fileList) 
        {            
            send_file_index += 1

            // 1. 파일 경로 길이 전송
            await writer.write(new Uint8Array(new Uint32Array([filePath.length]).buffer));
            console.log(`✔️ ${send_file_index} 전송 성공: ${filePath.length} 파일 길이`);
            await new Promise(resolve => setTimeout(resolve, 100));


            // 2. 파일 경로 데이터 전송
            await writer.write(new TextEncoder().encode(filePath));
            console.log(`✔️ 전송 성공: ${filePath} 파일 이름`);
            await new Promise(resolve => setTimeout(resolve, 100));

          


            // 3. ESP32가 MD5 체크섬 반환
            const { value } = await reader.read();
            const esp32Checksum = new TextDecoder().decode(value).trim();

            if (esp32Checksum === "ERROR") 
            {
                console.warn(`❌ 검증 실패: ${filePath}`);
                //failedFiles.push(filePath);
                await new Promise(resolve => setTimeout(resolve, 100));

                await writer.write(new Uint8Array([0xee]));   // 전송 시작 신호
                console.log("✔️ 전송 성공 [0xee] 파일 전송 시작 바이트");
                await new Promise(resolve => setTimeout(resolve, 100));

                await writer.write(new Uint8Array(1));
                console.log(`✔️ 전송 성공: 1 개의 파일`); // 파일 갯수
                await new Promise(resolve => setTimeout(resolve, 100));

                const fileUrl = BASE_URL + filePath;
                await sendFileToESP32(fileUrl, filePath, 0, 1); // 파일 전송
                await new Promise(resolve => setTimeout(resolve, 100));

                await writer.write(new Uint8Array([0xcc]));   // 검증 모드 신호
                console.log("✔️ 전송 성공 [0xCC] 검증 시작 바이트");
                await new Promise(resolve => setTimeout(resolve, 100));
        
                await writer.write(new Uint8Array(new Uint32Array([fileList.length - send_file_index]).buffer)); // 0. 파일 개수 전송
                console.log(`✔️ 전송 성공: ${fileList.length - send_file_index}개의 파일`);
                await new Promise(resolve => setTimeout(resolve, 100));                
              
            } 
            else 
            {
                console.log(`✅ 검증 성공: ${filePath}`);
            }





            // 짧은 지연 시간 추가 (예: 100밀리초)
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return failedFiles;
    } catch (error) {
        console.error("❌ 검증 실패:", error);
        return [];
    }
}


async function startTransfer() {
    console.log("✅ ver 7");
    await connectSerial();

    console.log("🔍 파일 검증 중...");
    let failedFiles = await validateFilesOnESP32();
    // let totalFiles = failedFiles.length;
    
    // document.getElementById("progressBarContainer").style.display = "block";
    // updateProgress(0, totalFiles, "전송 준비 중...");

    // while (failedFiles.length > 0) {
    //     console.log(`📌 ${failedFiles.length}개 파일 재전송 필요`);
    //     for (let i = 0; i < failedFiles.length; i++) {
    //         const file = failedFiles[i];
    //         const fileUrl = BASE_URL + file;
    //         await sendFileToESP32(fileUrl, file, i, totalFiles);
    //     }
    //     failedFiles = await validateFilesOnESP32();
    // }

    updateProgress(totalFiles, totalFiles, "🎉 모든 파일 전송 및 검증 완료!");
    console.log("🎉 모든 파일 전송 및 검증 완료!");
}

function updateProgress(current, total, message) {
    const progressBar = document.getElementById("progressBar");
    const progressText = document.getElementById("progressText");

    if (total === 0) {
        progressBar.style.width = "0%";
        progressText.innerText = "전송 준비 중...";
        return;
    }

    const percent = Math.round((current / total) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.innerText = `${message} (${percent}%)`;
}
