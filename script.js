let port;
let writer;
const BUFFER_SIZE = 256;

// GitHub Pages에서 파일 목록 가져오기 (예제 URL)
const FILE_LIST_URL = "https://raw.githubusercontent.com/your-username/your-repo/main/files.json";

async function fetchFileList() {
    try {
        const response = await fetch(FILE_LIST_URL);
        const files = await response.json();
        log(`?? 총 ${files.length}개의 파일 발견`);
        return files;
    } catch (error) {
        log("? 파일 목록을 불러올 수 없습니다.");
        return [];
    }
}

async function connectSerial() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 921600 });
        writer = port.writable.getWriter();
        log("? ESP32와 연결됨");
    } catch (error) {
        log("? 포트 연결 실패");
    }
}

async function sendFile(filePath, fileData) {
    if (!writer) {
        log("?? 포트가 열려있지 않습니다.");
        return;
    }

    const fileSize = fileData.length;
    log(`?? 전송 시작: ${filePath} (${fileSize} bytes)`);

    // 파일 경로 길이 전송
    await writer.write(new Uint8Array(new Uint32Array([filePath.length]).buffer));
    await writer.write(new TextEncoder().encode(filePath));

    // 파일 크기 전송
    await writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));

    // 파일 데이터 전송
    let totalSent = 0;
    while (totalSent < fileSize) {
        const chunk = fileData.slice(totalSent, totalSent + BUFFER_SIZE);
        await writer.write(chunk);
        totalSent += chunk.length;
    }

    log(`? 전송 완료: ${filePath}`);
}

async function startFileTransfer() {
    if (!port) {
        log("?? 먼저 포트를 선택하세요.");
        return;
    }

    const files = await fetchFileList();
    for (const filePath of files) {
        try {
            const response = await fetch(filePath);
            const fileData = new Uint8Array(await response.arrayBuffer());
            await sendFile(filePath, fileData);
        } catch (error) {
            log(`? 전송 실패: ${filePath}`);
        }
    }

    log("?? 모든 파일 전송 완료!");
}

function log(message) {
    const logElement = document.getElementById("log");
    logElement.innerHTML += `<p>${message}</p>`;
    logElement.scrollTop = logElement.scrollHeight;
}

document.getElementById("connect").addEventListener("click", connectSerial);
document.getElementById("start").addEventListener("click", startFileTransfer);
