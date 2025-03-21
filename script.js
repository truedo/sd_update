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

const VERSION_JS = '1.1.15'; 

let BUFFER_SIZE = 64; // 버퍼 크기 설정
let SEND_TERM = 50; // 명령간의 텀
let FILEDATA_TERM = 10; //쪼개서 보내는 파일 데이터 텀

let version_main = null;
let version_hw = null;
let version_sd = null;

class SDCardUploader 
{
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.BAUD_RATE = 921600; // 웹 최적화 버퍼 크기
    this.retryLimit = 3;
    this.timeout = 3000; // 기본 타임아웃 1초
  }

//   async function connectSerial() {
//     try {        
//         port = await navigator.serial.requestPort();
//         await port.open({ baudRate: BAUD_RATE });
//         writer = port.writable.getWriter();
//         reader = port.readable.getReader();
//         console.log("✅ 주미 미니 연결 성공!");
//     } catch (error) {
//         console.error("❌ 주미 미니 연결 실패:", error);
//     }
// }

  // 장치 연결
  async connect() {
    // try 
    // {
    //   this.port = await navigator.serial.requestPort();
    //   await this.port.open({ baudRate: BAUD_RATE });
    //   [this.reader, this.writer] = [
    //     this.port.readable.getReader(),
    //     this.port.writable.getWriter()        
    //   ];
    //   console.log("✅ 주미 미니 포트 연결: 성공!");
    // } 
    // catch (error) 
    // {
    //   console.error("❌ 주미 미니 포트 연결: 실패:", error);
    // }

    if (this.port && this.port.readable && this.port.writable) {
      console.log("⚠️ 포트가 이미 연결되어 있음!");
      return;
    }
    
    try {
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate: BAUD_RATE });
        [this.reader, this.writer] = [
            this.port.readable.getReader(),
            this.port.writable.getWriter()        
        ];
        console.log("✅ 주미 미니 포트 연결: 성공!");
    } catch (error) {
        console.error("❌ 주미 미니 포트 연결: 실패:", error);
    }
    
  }

  async disconnect() {
    try {    
      if (!this.port) {
          console.warn("⚠️ 포트가 연결되어 있지 않음!");
          return;
      }

      if (this.reader) {
        await this.reader.cancel();
        this.reader = null;
      }
      if (this.writer) {
        await this.writer.close();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
      console.log("🔚 주미 미니 포트 연결: 종료!");
    } 
    catch (error) 
    {
      console.error("❌ 포트 닫기 오류:", error);
    }
  }

  async getVersion(value) {
    //try {

        if (value === 0) await this.writer.write(new Uint8Array([0xb0]));   
        else if (value === 1) await this.writer.write(new Uint8Array([0xb1]));   
        else if (value === 2) await this.writer.write(new Uint8Array([0xb2]));   

        
        // 버전 길이 수신 (4바이트 리틀 엔디언)
        const lenBuffer = new Uint8Array(4);
        let received = 0;
        while (received < 4) {
            const { value } = await this.reader.read();
            lenBuffer.set(value.subarray(0, 4 - received), received);
            received += value.length;
        }
        const length = new DataView(lenBuffer.buffer).getUint32(0, true);
       // console.log(`버전 길이: ${length}`);
        
        // 버전 문자열 수신
        let version = '';
        received = 0;
        const versionBuffer = new Uint8Array(length);
        while (received < length) {
            const { value } = await this.reader.read();
            const remain = length - received;
            versionBuffer.set(value.subarray(0, remain), received);
            received += value.length;
        }
       // console.log(`버전: ${new TextDecoder().decode(versionBuffer)}`);
        return new TextDecoder().decode(versionBuffer);
    // } 
    // finally 
    // {
    //   //await this.disconnect();
    // }
  }

  // 리틀 엔디언 변환 (파이썬 struct.pack 대응)
  packUint32LE(value) {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, value, true);
    return new Uint8Array(buffer);
  }

  // ACK 대기 (파이썬 ser.read(1) 대응)
  async waitForACK() 
  {
    while(true) 
    {
      try 
      {
        const { value } = await Promise.race([
          this.reader.read(),
          new Promise((_, r) => setTimeout(r, this.timeout))
            .then(() => { throw new Error('ACK 타임아웃') })
        ]);
        const receivedByte = value[0];
        if(receivedByte === 0xE1) return true;
        if(receivedByte === 0xE2) throw new Error('크기 불일치');
        if(receivedByte === 0xE3) throw new Error('파일 없음');
      } 
      catch(error) 
      {
        if (error && error.message) {
          console.error(`ACK 오류: ${error.message}`);
        } else {
          console.error('ACK 오류: 알 수 없는 오류 발생');
        }  
        throw error;
      }
    }
  }

  // 파일 메타데이터 전송 (파이썬 send_file 구조 대응)
  async sendFileMetadata(relativePath, fileSize) 
  {
    const convertedPath = relativePath.replace(/\\/g, '/');
    const pathData = new TextEncoder().encode(convertedPath);

    // 🔶 1. 경로 길이 전송    
    console.log(`경로 길이 :${pathData.byteLength}`);
    await this.writer.write(this.packUint32LE(pathData.byteLength));
    await this.waitForACK();
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));
   // console.warn("경로 데이터 전송");

   
    // 🔶 2. 경로 데이터 전송
    await this.sendChunked(pathData);
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));
   // console.warn("파일 크기 전송");

    // 🔶 3. 크기 전송 (4바이트)
   // console.log(`📥 파일 크기: ${fileSize} bytes`);
    await this.writer.write(this.packUint32LE(fileSize));
  //  await this.writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));
    await this.waitForACK();
  //  await new Promise(resolve => setTimeout(resolve, SEND_TERM));
  }

  // 청크 분할 전송 (파이썬 버퍼링 대응)
  async sendChunked(data) 
  {
    for(let offset=0; offset<data.length; offset+=BUFFER_SIZE) 
    {
      const chunk = data.slice(offset, offset+BUFFER_SIZE);
      await this.writer.write(chunk);
      await this.waitForACK();
      await new Promise(resolve => setTimeout(resolve, FILEDATA_TERM));
    }
  }

  // 파일 전송 메인 로직 (파이썬 send_file 대응)
  async sendFile(file, relativePath) {
    let retryCount = 0;
    // const fileSize = file.size;
    // const fileReader = file.stream().getReader();

    await this.writer.write(new Uint8Array([0xee])); // 전송 모드
    await this.waitForACK();
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));


    // 🔷 0-2. 파일 개수 전송 4바이트
    await this.writer.write(this.packUint32LE(1));
    await this.waitForACK();
    // console.log(`✔️ 전송 성공: 1 개의 파일`);
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    const response = await fetch(file);   // file은 URL
    const blob = await response.blob();
    const fileSize = blob.size;

    //console.log(`response ${response}`);
    //console.log(`fileSize ${fileSize}`);

    // Blob은 스트림을 지원하므로, 스트림을 가져올 수 있습니다.
    const fileReader = blob.stream().getReader();

    console.log(`📩 파일 전송 시작`);

    while(retryCount < this.retryLimit) 
    {
      try 
      {
        // 메타데이터 전송
        await this.sendFileMetadata(relativePath, fileSize);
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));
        
        // 파일 데이터 전송
        while(true) 
        {
          const { done, value } = await fileReader.read();
          if(done)
          {
            console.log(`✔️ 파일 전송 완료`);
            break;
          }
          await this.sendChunked(value);         
        }
        
        // 최종 검증
       // await this.writer.write(new Uint8Array([0xCC])); // 검증 신호
        return await this.waitForACK();        
      } 
      catch(error) 
      {
        //console.error(`전송 실패 (시도 ${retryCount+1}): ${error.message}`);
        if (error && error.message) {
          console.error(`전송 실패 (시도 ${retryCount+1}): ${error.message}`);
        } else {
          console.error(`전송 실패 (시도 ${retryCount+1}): 알 수 없는 오류 발생`);
        }        
        await this.resetConnection();
        retryCount++;
      }
    }
    throw new Error(`최종 전송 실패: ${relativePath}`);
  }

  // 연결 재설정 (파이썬 ser 재생성 대응)
  async resetConnection() {
    await this.reader.cancel();
    await this.writer.close();
    [this.reader, this.writer] = [
      this.port.readable.getReader(),
      this.port.writable.getWriter()
    ];
  }

  // 폴더 검증 (파이썬 validate_files 대응)
  async validateFiles(files) {
    // 🔷 0-1. 검증 모드 신호 (0xCC) 1바이트
    await this.writer.write(new Uint8Array([0xCC])); // 검증 모드
    await this.waitForACK();
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    // 🔷 0-2. 개수 전송 4바이트
    await this.writer.write(this.packUint32LE(files.length));
    await this.waitForACK();
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    console.log(`✔️ 전송 성공: ${files.length}개의 파일`);

    let send_file_index = 0;
    const totalFiles = fileList.length;

    for (const relativePath of files) 
    {          
      send_file_index += 1;
      //const relativePath = file.webkitRelativePath || file.name;

      // 진행 상태 업데이트
      updateProgress(send_file_index, totalFiles, relativePath);

      console.log(`✔️ ${send_file_index}: ${relativePath}`);

      // 📌 파일 크기 확인
      const fileUrl = BASE_URL + relativePath;        
      let fileData;
      try {
          fileData = await fetchFileWithRetry(fileUrl);
      } catch (error) {
          console.error(error);
          return;
      }
      const fileSize = fileData.byteLength;
      //console.log(`📥 최종 다운로드한 파일 크기: ${fileSize} bytes`);

      await this.sendFileMetadata(relativePath, fileSize);

      //console.log(`⌚검증 기다리기`);
      try 
      {
        await this.waitForACK();
       // console.log(`✅ ${send_file_index} 검증 완료: ${relativePath}`);
      } 
      catch(error) 
      {
        console.log(`❌ ${send_file_index} 검증 실패: ${relativePath}`);
//await new Promise(resolve => setTimeout(resolve, SEND_TERM));
await new Promise(resolve => setTimeout(resolve, 1000));

        await this.sendFile(fileUrl, relativePath); // 재전송
//await new Promise(resolve => setTimeout(resolve, SEND_TERM));
await new Promise(resolve => setTimeout(resolve, 1000));

        await this.writer.write(new Uint8Array([0xCC])); // 검증 모드
        await this.waitForACK();
//await new Promise(resolve => setTimeout(resolve, SEND_TERM));
await new Promise(resolve => setTimeout(resolve, 1000));


        await this.writer.write(this.packUint32LE(files.length- send_file_index));
        await this.waitForACK();
        console.log(`✔️ ${send_file_index} 남은 갯수: ${files.length - send_file_index}개`); 

await new Promise(resolve => setTimeout(resolve, 1000));

      }
      await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    }
  }
}
const uploader = new SDCardUploader();

async function validateFiles_all() 
{   
  const startTime = Date.now(); // ⏱ 전송 시작 시간 기록

  console.log(`ver ${VERSION_JS}`);

  const fileList = await loadFileList();
  if (fileList.length === 0) 
  {
      console.log("❌ 전송할 파일이 없습니다.");
      return;
  }
  try 
  {
    await uploader.connect();
    await uploader.validateFiles(fileList);
    console.log("🎉 모든 파일 전송 완료!");
  } 
  catch(error) 
  {
    console.error("❌ 전송 실패:", error);
  }

  await uploader.disconnect()


  const endTime = Date.now(); // ⏱ 전송 종료 시간 기록
  const elapsedTime = (endTime - startTime) / 1000; // 초 단위 변환
  const minutes = Math.floor(elapsedTime / 60);
  const seconds = Math.round(elapsedTime % 60);

  console.log(`⏳ 총 소요 시간: ${minutes}분 ${seconds}초`);
}




async function sendHWFirmInput() 
{
  await uploader.connect();

  console.log(`📩 HW 펌웨어 입력 시작`);
  await uploader.writer.write(new Uint8Array([0xDD])); // HW 펌웨어 입력 모드
  await new Promise(resolve => setTimeout(resolve, SEND_TERM));

  await uploader.disconnect()
}


async function sendMainFirmInput() 
{
  await uploader.connect();
  console.log(`📩 Main 펌웨어 입력 시작`);
  await uploader.writer.write(new Uint8Array([0xAA])); // MAIN 펌웨어 입력 모드
  await new Promise(resolve => setTimeout(resolve, SEND_TERM));

  await uploader.disconnect()
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

async function loadFileList2() {
  try {
      const response = await fetch("files.json"); // 🔹 파일 리스트 JSON 불러오기
      if (!response.ok) throw new Error("파일 목록을 불러올 수 없습니다.");
      
      const fileList = await response.json();
      const fileSelect = document.getElementById("fileList");

      // 🔹 기존 옵션 초기화
      fileSelect.innerHTML = "";
      
      fileList.forEach(file => {
          const option = document.createElement("option");
          option.value = file;
          option.textContent = file;
          fileSelect.appendChild(option);
      });

      fileSelect.disabled = false;
  } catch (error) {
      console.error("❌ 파일 목록 로드 실패:", error);
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

// 🔹 버퍼 크기 선택 시 업데이트
document.getElementById("bufferSize").addEventListener("change", function() {
    BUFFER_SIZE = parseInt(this.value, 10); // 선택된 값 적용
    document.getElementById("selectedBufferSize").innerText = `현재 설정된 버퍼 크기: ${BUFFER_SIZE} bytes`;
});


// 🔹 전송 텀 선택 시 업데이트
document.getElementById("sendTerm").addEventListener("change", function() {
    SEND_TERM = parseInt(this.value, 10); // 선택된 값 적용
    document.getElementById("selectedsendTerm").innerText = `현재 설정된 전송 텀: ${SEND_TERM} ms`;
});

// 🔹 파일데이터 텀 선택 시 업데이트
document.getElementById("fileDataTerm").addEventListener("change", function() {
    FILEDATA_TERM = parseInt(this.value, 10); // 선택된 값 적용
    document.getElementById("selectedfileDataTerm").innerText = `현재 설정된 파일데이터 텀: ${FILEDATA_TERM} ms`;
});

function updateProgress(currentIndex, totalFiles, filePath)
{
    const progressContainer = document.getElementById('progressContainer');
    progressContainer.style.display = 'block';  // 프로그레스바를 보이게 함

    const percent = Math.round((currentIndex / totalFiles) * 100);
    
    // 진행 바 업데이트
    //document.getElementById("progressBar").style.width = percent + "%";
    document.getElementById("progressBar").style.width = percent*3 + "px";
    // 진행 상태 텍스트 업데이트
    document.getElementById("progressText").innerText =
        `📂 진행 중: ${currentIndex}/${totalFiles} 파일 완료 (${percent}%)\n` +
        `📝 현재 파일: ${filePath}`;
}

// 🔹 페이지 로드 시 파일 목록 불러오기
document.addEventListener("DOMContentLoaded", loadFileList2);

document.getElementById("sendSelectedFile").addEventListener("click", async function() {
    const fileSelect = document.getElementById("fileList");
    const selectedFile = fileSelect.value;

    if (!selectedFile) {
        alert("전송할 파일을 선택하세요!");
        return;
    }

    document.getElementById("selectedFileInfo").innerText = `📂 선택된 파일: ${selectedFile}`;

    console.log(`ver ${VERSION_JS}`);

    document.getElementById("selectedfileStatus").innerText = "전송 중";

    const fileUrl = BASE_URL + selectedFile;

    await uploader.connect();
    await uploader.sendFile(fileUrl, selectedFile);

    await uploader.disconnect()
    

    document.getElementById("selectedfileStatus").innerText = "전송 완료!";


});

document.getElementById('versionBtn').addEventListener('click', async () => {
  
    await uploader.connect();
    version_main = await uploader.getVersion(0);
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    version_hw = await uploader.getVersion(1);
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    version_sd = await uploader.getVersion(2);
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    document.getElementById('versionDisplay').textContent 
    = `펌웨어 버전: main: ${version_main} HW:${version_hw} SD:${version_sd}`;

    await uploader.disconnect()



    
// // 문자열 버전을 숫자로 변환
// let version_main_number = parseFloat(version_main);
// let version_compare = 1.24;
// // 비교
// if (version_main_number > version_compare) {
//     console.log(`${version_main}은 ${version_compare}보다 큽니다.`);
// } else if (version_main_number < version_compare) {
//     console.log(`${version_main}은 ${version_compare}보다 작습니다.`);
// } else {
//     console.log(`${version_main}은 ${version_compare}과 동일합니다.`);
// }

});