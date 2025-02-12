// const GITHUB_USER = "truedo";
// const REPO_NAME = "sd_update";
// const BRANCH = "main";
// const BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/sd_update_files/`;

const BASE_URL = 'https://startling-tanuki-ea7c77.netlify.app/';

let port;
let writer;
let reader;
const BAUD_RATE = 921600;
const TIMEOUT = 3000; // ms

const VERSION_JS = '1.0.22'; 

const BUFFER_SIZE = 64; // 버퍼 크기 설정
const MAX_RETRIES_SEND = 3; // 최대 재전송 횟수

const SEND_TERM = 50; // 명령간의 텀
const FILEDATA_TERM = 10; //쪼개서 보내는 파일 데이터 텀

async function connectSerial() {
    try {        
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: BAUD_RATE });

        writer = port.writable.getWriter();
        reader = port.readable.getReader();

        console.log("✅ 주미 미니 연결 성공!");
    } catch (error) {
        console.error("❌ 주미 미니 연결 실패:", error);
    }
}

async function loadFileList() {
    try {
        const response = await fetch("files.json"); // 로컬 JSON 불러오기             
        const fileList = await response.json();
        const fullUrls = fileList.map(file => file);

       // console.log("✅ 다운로드할 파일 목록:", fullUrls);
        console.log(`📂 총 ${fileList.length}개의 파일 발견`);

        return fullUrls;

    } catch (error) {
        console.error("❌ 파일 목록 로드 실패:", error);
        return [];
    }
}

async function fetchFileWithRetry(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
       // console.log(`📥 서버 파일 다운로드 시도 ${attempt}/${retries}: ${url}`);

        // 브라우저 캐시 방지
        const uniqueUrl = `${url}?_=${new Date().getTime()}`;
        const response = await fetch(uniqueUrl, { cache: "no-store" });

        if (!response.ok) {
            console.error(`❌ 서버 파일 다운로드 실패 (시도 ${attempt}/${retries}): HTTP ${response.status}`);
            continue; // 다음 재시도
        }

        // Content-Length 제거 (압축 문제 해결)
        const fileData = await response.arrayBuffer();
        const fileSize = fileData.byteLength;

    //    console.log(`✅ 서버 파일 다운로드 성공: (${attempt}/${retries}): ${fileSize} bytes`);
        return fileData;
    }

    throw new Error("❌ 서버 파일 다운로드 실패: 모든 재시도 실패");
}

async function testSingleFileTransfer() 
{    
    console.log(`ver ${VERSION_JS}`);
    await connectSerial(); // ESP32 연결

    const fileList = await loadFileList();
    if (fileList.length === 0) {
        console.log("❌ 전송할 파일이 없습니다.");
        return;
    }

    const fileUrl = BASE_URL + fileList[10]; // 첫 번째 파일 가져오기
    const filePath = fileList[10]; // 상대 경로 유지

    await new Promise(resolve => setTimeout(resolve, 100));

    console.log(`🚀 테스트 파일 전송 시작: ${filePath}`);

    let retryCount = 0;
    let success = false;

    await writer.write(new Uint8Array([0xee]));   // 전송 시작 신호
    console.log("✔️ 전송 성공 [0xee] 파일 전송 시작 바이트");
    await new Promise(resolve => setTimeout(resolve, 100));

    //await writer.write(new Uint8Array([0x01])); // 파일 개수 전송 (1개)
    await writer.write(new Uint32Array([0x01])); // 파일 개수 전송 (1개)
    console.log(`✔️ 전송 성공: 1 개의 파일`);
    await new Promise(resolve => setTimeout(resolve, 100));

    while (retryCount < MAX_RETRIES_SEND && !success) 
    {      
        if (retryCount > 0) 
        {
            console.warn(`📌 재전송 시도: ${retryCount}/${MAX_RETRIES_SEND}`);
        }

        // 파일 경로 길이 전송
        await writer.write(new Uint8Array(new Uint32Array([filePath.length]).buffer));
        console.log(`✔️ 전송 성공: ${filePath.length} 파일 길이`);
        await new Promise(resolve => setTimeout(resolve, 100));

        // 파일 경로 데이터 전송
        await writer.write(new TextEncoder().encode(filePath));
        console.log(`✔️ 전송 성공: ${filePath} 파일 이름`);
        await new Promise(resolve => setTimeout(resolve, 100));

      
        // 📌 파일 크기 확인 (서버 Content-Length)
        let fileData;
        try {
            fileData = await fetchFileWithRetry(fileUrl);
        } catch (error) {
            console.error(error);
            return;
        }

        // 파일 크기 전송 (4바이트)
        const fileSize = fileData.byteLength;
        console.log(`📥 최종 다운로드한 파일 크기: ${fileSize} bytes`);
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
            await new Promise(resolve => setTimeout(resolve, 10));
            totalSent += chunk.length;

          // 진행률 표시
            const percent = Math.round((totalSent / fileSize) * 100);
            console.log(`📊 진행률: ${percent}% (${totalSent}/${fileSize} bytes)`);
        }

        console.log(`✅ 전송 완료: ${filePath}`);

        console.log(`❓ 수신 ACK 대기중`);

        // ESP32로부터 ACK 수신
        const { value } = await reader.read();
        const receivedByte = value[0]; 

        console.log(`📩 받은 ACK: 0x${receivedByte.toString(16).toUpperCase()}`); // hex 출력

        if (receivedByte === 0xE1) 
        { 
            console.log("✔️ 전송 성공");
            success = true;
        } 
        else 
        {
            if (receivedByte === 0xE2) 
            {
                console.warn("❌ 파일 바이트 부족 - 재전송 필요");
            } 
            else if (receivedByte === 0xE3) 
            {
                console.warn("❌ 파일 바이트 다름 - 재전송 필요");
            } 
            // else 
            // {
                console.warn("❌ 전송 오류 - 재전송 필요");
            //}
            retryCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!success) 
    {
        console.error("❌ 파일 전송 실패: 최대 재전송 횟수 초과");
    }
}

async function SingleFileTransfer(fileUrl, filePath) 
{ 
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    console.log(`🚀 파일 전송 시작: ${filePath}`);

    let retryCount = 0;
    let success = false;

    // 🔷 0-1. 전송 모드 신호 (0xee) 1바이트
    await writer.write(new Uint8Array([0xee]));   // 전송 시작 신호
    // console.log("✔️ 전송 성공 [0xee] 파일 전송 시작 바이트");
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    // 🔷 0-2. 파일 개수 전송 4바이트
    await writer.write(new Uint32Array([0x01])); // 파일 개수 전송 (1개)
    // console.log(`✔️ 전송 성공: 1 개의 파일`);
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    while (retryCount < MAX_RETRIES_SEND && !success) 
    {      
        if (retryCount > 0) 
        {
            console.warn(`📌 재전송 시도: ${retryCount}/${MAX_RETRIES_SEND}`);
        }

        // 🔶 1. 파일 경로 길이 전송
        await writer.write(new Uint8Array(new Uint32Array([filePath.length]).buffer));
        // console.log(`✔️ 전송 성공: ${filePath.length} 파일 길이`);
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));

        // 🔶 2. 파일 경로 데이터 전송
        await writer.write(new TextEncoder().encode(filePath));
        // console.log(`✔️ 전송 성공: ${filePath} 파일 이름`);
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));
  
    
        // 📌 파일 크기 확인
        let fileData;
        try {
            fileData = await fetchFileWithRetry(fileUrl);
        } catch (error) {
            console.error(error);
            return;
        }

        // 🔶 3. 파일 크기 전송 (4바이트)
        const fileSize = fileData.byteLength;
        // console.log(`📥 최종 다운로드한 파일 크기: ${fileSize} bytes`);
        await writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));
        // console.log(`✔️ 전송 성공: ${fileSize} 바이트 파일 크기`);
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));

        // 📌 4. 파일 데이터 전송 (버퍼 사이즈 만큼 나누어 전송)
        let totalSent = 0;
        const fileArray = new Uint8Array(fileData);

        console.log(`📤 파일 전송 시작: ${filePath}`);
        for (let i = 0; i < fileSize; i += BUFFER_SIZE) {
            const chunk = fileArray.slice(i, i + BUFFER_SIZE);
            await writer.write(chunk);
            await new Promise(resolve => setTimeout(resolve, FILEDATA_TERM));
            totalSent += chunk.length;

            // 진행률 표시
            //  const percent = Math.round((totalSent / fileSize) * 100);
            //  console.log(`📊 진행률: ${percent}% (${totalSent}/${fileSize} bytes)`);
        }

        //console.log(`✅ 전송 완료: ${filePath}`);

        // 🔶 5. 전송 ACK 수신 1바이트
        console.log(`❓ 전송 ACK 대기중`);

        // ESP32로부터 ACK 수신
        const { value } = await reader.read();
        const receivedByte = value[0]; 

        //console.log(`📩 받은 ACK: 0x${receivedByte.toString(16).toUpperCase()}`); // hex 출력

        if (receivedByte === 0xE1) 
        { 
            console.log("✔️ 전송 성공");
            success = true;
        } 
        else 
        {
            // if (receivedByte === 0xE2) 
            // {
            //     console.warn("❌ 파일 바이트 부족 - 재전송 필요");
            // } 
            // else if (receivedByte === 0xE3) 
            // {
            //     console.warn("❌ 파일 바이트 다름 - 재전송 필요");
            // } 
            // else 
            // {
                console.warn("❌ 전송 오류 - 재전송 필요");
            //}
            retryCount++;
        }
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));
    }
    if (!success) 
    {
        console.error("❌ 파일 전송 실패: 최대 재전송 횟수 초과");
    }
}

async function validateFilesOnESP32() 
{     
    const fileList = await loadFileList();

    // 🔷 0-1. 검증 모드 신호 (0xCC) 1바이트
    await writer.write(new Uint8Array([0xCC]));  
    // console.log("✔️ 전송 성공 [0xCC] 검증 시작 바이트");
    await new Promise(resolve => setTimeout(resolve, SEND_TERM)); // 작은 지연

    // 🔷 0-2. 파일 개수 전송 4바이트
    await writer.write(new Uint8Array(new Uint32Array([fileList.length]).buffer));
    console.log(`✔️ 전송 성공: ${fileList.length}개의 파일`);
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    let send_file_index = 0;

    for (const filePath of fileList) 
    {            
        send_file_index += 1;

        // 진행 상태 업데이트
        updateProgress(send_file_index, totalFiles, filePath);


        // 🔶 1. 파일 경로 길이 전송
        await writer.write(new Uint8Array(new Uint32Array([filePath.length]).buffer));
        // console.log(`✔️ ${send_file_index} 전송 성공: ${filePath.length} 파일 길이`);
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));

        // 🔶 2. 파일 경로 데이터 전송
        await writer.write(new TextEncoder().encode(filePath));
        //  console.log(`✔️ 전송 성공: ${filePath} 파일 이름`);
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));

        
        // 📌 파일 크기 확인
        const fileUrl = BASE_URL + filePath;        
        let fileData;
        try {
            fileData = await fetchFileWithRetry(fileUrl);
        } catch (error) {
            console.error(error);
            return;
        }

        // 🔶 3. 파일 크기 전송 (4바이트)
        const fileSize = fileData.byteLength;
        // console.log(`📥 최종 다운로드한 파일 크기: ${fileSize} bytes`);
        await writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));
        // console.log(`✔️ 전송 성공: ${fileSize} 바이트 파일 크기`);
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));                        
        
        // 🔶 4. 검증 ACK 수신 1바이트
        console.log(`❓ ${send_file_index} 검증 ACK 대기중`);      
        const { value } = await reader.read();
        const receivedByte = value[0]; 
        //console.log(`📩 받은 ACK: 0x${receivedByte.toString(16).toUpperCase()}`); // hex 출력

        if (receivedByte === 0xE1) 
        { 
            const receivedByte = value[0]; 
            console.log(`✅ 검증 성공: ${filePath}`);
        } 
        else 
        {
            if (receivedByte === 0xE2) 
            {
                console.warn("❌ 검증 실패 (파일 크기 다름) - 재전송 필요");
            } 
            else if (receivedByte === 0xE3) 
            {
                console.warn("❌ 검증 실패 (파일 열수 없음) - 재전송 필요");
            }
        
            // 🟡
            await SingleFileTransfer(fileUrl, filePath);
            await new Promise(resolve => setTimeout(resolve, SEND_TERM));

             // 🔷 검증 모드 신호 (0xCC) 1바이트
            await writer.write(new Uint8Array([0xcc]));   // 
            // console.log("✔️ 전송 성공 [0xCC] 검증 시작 바이트");
            await new Promise(resolve => setTimeout(resolve, SEND_TERM));
    
             // 🔷 파일 개수 전송 4바이트
            await writer.write(new Uint8Array(new Uint32Array([fileList.length - send_file_index]).buffer)); // 0. 파일 개수 전송
            console.log(`✔️ ${send_file_index} 남은 갯수: ${fileList.length - send_file_index}개`);      
        }           
        
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));
    }   
    // 전체 전송 완료 메시지 표시
    updateProgress(totalFiles, totalFiles, "모든 파일 검증 완료 ✅");
}

async function startTransfer() 
{
    const startTime = Date.now(); // ⏱ 전송 시작 시간 기록

    console.log(`ver ${VERSION_JS}`);
    await connectSerial();

    console.log("🔍 파일 검증 시작...");
    await validateFilesOnESP32();
   
    console.log("🎉 모든 파일 전송 및 검증 완료!");

    const endTime = Date.now(); // ⏱ 전송 종료 시간 기록
    const elapsedTime = (endTime - startTime) / 1000; // 초 단위 변환
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = Math.round(elapsedTime % 60);

    console.log(`⏳ 총 소요 시간: ${minutes}분 ${seconds}초`);
}

function updateProgress(currentIndex, totalFiles, filePath) {
    const percent = Math.round((currentIndex / totalFiles) * 100);
    
    // 진행 바 업데이트
    document.getElementById("progressBar").style.width = percent + "%";

    // 진행 상태 텍스트 업데이트
    document.getElementById("progressText").innerText =
        `📂 진행 중: ${currentIndex}/${totalFiles} 파일 완료 (${percent}%)\n` +
        `📝 현재 파일: ${filePath}`;
}