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

        const textEncoder = new TextEncoderStream();
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
        const writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
        
        writer = textEncoder.writable.getWriter();
        reader = textDecoder.readable.getReader();
        
        console.log("✅ ESP32 연결 성공!");
    } catch (error) {
        console.error("❌ ESP32 연결 실패:", error);
    }
}

async function loadFileList() {
    try {
        const response = await fetch("files.json");
        const fileList = await response.json();
        return fileList.map(file => BASE_URL + file);
    } catch (error) {
        console.error("❌ 파일 목록 로드 실패:", error);
        return [];
    }
}

async function sendFileToESP32(fileUrl, relativePath, index, totalFiles) {
    try {
        const response = await fetch(fileUrl);
        const fileData = await response.arrayBuffer();
        const fileSize = fileData.byteLength;

        console.log(`📤 전송 중: ${relativePath} (${fileSize} bytes)`);

        updateProgress(index, totalFiles, `전송 중: ${relativePath}`);

        // 1. 파일 경로 길이 전송
        const pathLength = new Uint32Array([relativePath.length]);
        await writer.write(pathLength);

        // 2. 파일 경로 전송
        await writer.write(new TextEncoder().encode(relativePath));

        // 3. 파일 크기 전송
        const fileSizeBuffer = new Uint32Array([fileSize]);
        await writer.write(fileSizeBuffer);

        // 4. 파일 데이터 전송
        await writer.write(new Uint8Array(fileData));

        console.log(`✅ 전송 완료: ${relativePath}`);

        // 5. ESP32로부터 ACK 수신
        const ack = await reader.read();
        if (ack.value === "\xe1") {
            console.log("✔️ 전송 성공");
            updateProgress(index + 1, totalFiles, `✅ 완료: ${relativePath}`);
            return true;
        } else {
            console.warn("❌ 전송 실패, 다시 시도");
            updateProgress(index, totalFiles, `⚠️ 실패: ${relativePath}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ 파일 전송 오류: ${relativePath}`, error);
        updateProgress(index, totalFiles, `❌ 오류: ${relativePath}`);
        return false;
    }
}

async function validateFilesOnESP32() {
    try {
        await writer.write(new Uint8Array([0xcc])); // 검증 모드 신호

        const fileList = await loadFileList();
        let failedFiles = [];

        for (const filePath of fileList) {
            await writer.write(new TextEncoder().encode(filePath)); // 파일 이름 전송
            
            // ESP32가 MD5 체크섬 반환
            const { value } = await reader.read();
            const esp32Checksum = new TextDecoder().decode(value).trim();

            if (esp32Checksum === "ERROR") {
                console.warn(`❌ 검증 실패: ${filePath}`);
                failedFiles.push(filePath);
            } else {
                console.log(`✅ 검증 성공: ${filePath}`);
            }
        }

        return failedFiles;
    } catch (error) {
        console.error("❌ 검증 실패:", error);
        return [];
    }
}

async function startTransfer() {
    await connectSerial();

    console.log("🔍 파일 검증 중...");
    let failedFiles = await validateFilesOnESP32();
    let totalFiles = failedFiles.length;
    
    document.getElementById("progressBarContainer").style.display = "block";
    updateProgress(0, totalFiles, "전송 준비 중...");

    while (failedFiles.length > 0) {
        console.log(`📌 ${failedFiles.length}개 파일 재전송 필요`);
        for (let i = 0; i < failedFiles.length; i++) {
            const file = failedFiles[i];
            const fileUrl = BASE_URL + file;
            await sendFileToESP32(fileUrl, file, i, totalFiles);
        }
        failedFiles = await validateFilesOnESP32();
    }

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