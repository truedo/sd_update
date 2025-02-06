let port;
let writer;
const BUFFER_SIZE = 256;

// GitHub Pages에서 파일 목록 가져오기 (예제 URL)
const FILE_LIST_URL = "https://raw.githubusercontent.com/truedo/sd_update/main/files.json";


const GITHUB_USER = "truedo";  
const REPO_NAME = "sd_update";  
const BRANCH = "main";  
const BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/sd_update_files/`;

async function loadFileList() {
    try {
        const response = await fetch("files.json"); // 로컬 JSON 불러오기
        const fileList = await response.json();

        // 전체 URL 만들기
        const fullUrls = fileList.map(file => BASE_URL + file);

        console.log("✅ 다운로드할 파일 목록:", fullUrls);
        log(`📂 총 ${fileList.length}개의 파일 발견`);
        return fullUrls;
    } 
    catch (error) 
    {
        console.error("❌ 파일 목록 불러오기 실패:", error);
        return [];
    }
}


// async function fetchFileList() {
//     try {
//         const response = await fetch(FILE_LIST_URL);
//         const files = await response.json();


//         log(`📂 총 ${files.length}개의 파일 발견`);
//         return files;

//     } catch (error) {
//         log("❌ 파일 목록을 불러올 수 없습니다.");
//         return [];
//     }
// }

async function connectSerial() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 921600 });
        writer = port.writable.getWriter();
        log("✅ ESP32와 연결됨");
    } catch (error) {
        log("❌ 포트 연결 실패");
    }
}

async function sendFile(filePath, fileData) {
    if (!writer) {
        log("⚠️ 포트가 열려있지 않습니다.");
        return;
    }

    const fileSize = fileData.length;
    log(`📤 전송 시작: ${filePath} (${fileSize} bytes)`);

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

    log(`✅ 전송 완료: ${filePath}`);
}

async function startFileTransfer() {
    if (!port) {
        log("⚠️ 먼저 포트를 선택하세요.");
        return;
    }

    //const files = await fetchFileList();
    const files = await loadFileList();


    // for (const filePath of files) {
    //     try {
    //         const response = await fetch(filePath);
    //         const fileData = new Uint8Array(await response.arrayBuffer());
    //         await sendFile(filePath, fileData);
    //     } catch (error) {
    //         log(`❌ 전송 실패: ${filePath}`);
    //     }
    // }

    log("🎉 모든 파일 전송 완료!");
}

function log(message) {
    const logElement = document.getElementById("log");
    logElement.innerHTML += `<p>${message}</p>`;
    logElement.scrollTop = logElement.scrollHeight;
}


document.getElementById("start").addEventListener("click", startFileTransfer);
document.getElementById("connect").addEventListener("click", connectSerial);

// document.getElementById('connect').addEventListener('click', async () => {
//     try {
//         if (!("serial" in navigator)) {
//             alert("❌ Web Serial API를 지원하지 않는 브라우저입니다.");
//             return;
//         }
//         const port = await navigator.serial.requestPort();  // 사용자가 포트 선택
//         await port.open({ baudRate: 9600 }); // 포트 열기
//         const encoder = new TextEncoderStream();
//         const writableStreamClosed = encoder.readable.pipeTo(port.writable);
//         const writer = encoder.writable.getWriter();
//         console.log("✅ 포트 연결됨");
//         // GitHub 파일 다운로드 후 전송
//         const response = await fetch('https://raw.githubusercontent.com/user/repo/branch/file.txt');
//         const fileContent = await response.text();
//         await writer.write(fileContent); // 파일 전송
//         writer.releaseLock();
//         console.log("✅ 파일 전송 완료");
//         // 포트 닫기
//         await writableStreamClosed;
//         await port.close();
//         console.log("✅ 포트 닫힘");
//     } catch (error) {
//         console.error("❌ 시리얼 포트 오류:", error);
//     }
// });
