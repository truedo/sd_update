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

const VERSION_JS = '1.0.61'; 

let BUFFER_SIZE = 64; // 버퍼 크기 설정
let SEND_TERM = 50; // 명령간의 텀
let FILEDATA_TERM = 10; //쪼개서 보내는 파일 데이터 텀

const MAX_RETRIES_SEND = 3; // 최대 재전송 횟수


class SDCardUploader 
{
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.BUFFER_SIZE = 64; // 웹 최적화 버퍼 크기
    this.retryLimit = 3;
    this.timeout = 1000; // 기본 타임아웃 1초
  }

  // 장치 연결
  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 921600 });
    [this.reader, this.writer] = [
      this.port.readable.getReader(),
      this.port.writable.getWriter()
    ];
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
    // console.log(`❓ ACK 대기중`);
    // const { value } = await this.reader.read();
    // const receivedByte = value[0];
    // if(receivedByte === 0xE1) 
    //   {
    //     console.warn("✔️ACK 성공");
    //     return true;
    //   }
    // if(receivedByte === 0xE2) throw new Error('CRC 오류');
    // if(receivedByte === 0xE3) throw new Error('크기 불일치');

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
        if(receivedByte === 0xE2) throw new Error('CRC 오류');
        if(receivedByte === 0xE3) throw new Error('크기 불일치');
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
    await this.writer.write(this.packUint32LE(pathData.byteLength));
    await this.waitForACK();
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));
   // console.warn("경로 데이터 전송");

    // 🔶 2. 경로 데이터 전송
    await this.sendChunked(pathData);
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));
   // console.warn("파일 크기 전송");

    // 🔶 3. 크기 전송 (4바이트)
    console.log(`📥 파일 크기: ${fileSize} bytes`);
    await this.writer.write(this.packUint32LE(fileSize));
  //  await this.writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));
    await this.waitForACK();
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));
  }

  // 청크 분할 전송 (파이썬 버퍼링 대응)
  async sendChunked(data) 
  {
    for(let offset=0; offset<data.length; offset+=this.BUFFER_SIZE) 
    {
      const chunk = data.slice(offset, offset+this.BUFFER_SIZE);
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

    await this.writer.write(new Uint8Array([0xee])); // 검증 모드
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    // 🔷 0-2. 파일 개수 전송 4바이트
    await this.writer.write(this.packUint32LE(1));
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

    while(retryCount < this.retryLimit) {
      try {
        // 메타데이터 전송
        await this.sendFileMetadata(relativePath, fileSize);
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));
        
        // 파일 데이터 전송
        while(true) {
          const { done, value } = await fileReader.read();
          if(done)
          {
            console.log(`✔️ 파일 전송 완료`);
            break;
          }
          await this.sendChunked(value);
         
        }
        
        // 최종 검증
        await this.writer.write(new Uint8Array([0xCC])); // 검증 신호
        return await this.waitForACK();
        
      } catch(error) {
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
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));
    // 🔷 0-2. 개수 전송 4바이트
    await this.writer.write(this.packUint32LE(files.length));
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    console.log(`✔️ 전송 성공: ${files.length}개의 파일`);

    let send_file_index = 0;
    //for(const [index, file] of files.entries()) 
    for (const relativePath of files) 
    {          
      send_file_index += 1;
      //const relativePath = file.webkitRelativePath || file.name;

      console.log(`✔️ ${send_file_index}: ${relativePath} 파일 이름`);

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
     // console.log(`📥 최종 다운로드한 파일 크기: ${fileSize} bytes`);

      await this.sendFileMetadata(relativePath, fileSize);

      // console.log(`⌚검증 기다리기`);
      try 
      {
        await this.waitForACK();
        console.log(`✅ ${send_file_index} 검증 완료: ${relativePath}`);
      } 
      catch(error) 
      {
        console.log(`❌ ${send_file_index} 검증 실패: ${relativePath}`);
        await this.sendFile(fileUrl, relativePath); // 재전송
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));
        await this.writer.write(new Uint8Array([0xCC])); // 검증 모드
        await new Promise(resolve => setTimeout(resolve, SEND_TERM));
        await this.writer.write(this.packUint32LE(files.length- send_file_index));
        console.log(`✔️ ${send_file_index} 남은 갯수: ${files.length - send_file_index}개`);  
      }
      await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    }
  }
}
const uploader = new SDCardUploader();
// // 사용 예시
// const uploader = new SDCardUploader();
// document.querySelector('#uploadBtn').addEventListener('click', async () => {
//   try {
//     await uploader.connect();
//     const files = await getFilesFromDirectory(); // 웹 디렉토리 접근
//     await uploader.validateFiles(files);
//     console.log("모든 파일 전송 완료!");
//   } catch(error) {
//     console.error("전송 실패:", error);
//   }
// });


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

    const fileList = await loadFileList();
    if (fileList.length === 0) {
        console.log("❌ 전송할 파일이 없습니다.");
        return;
    }

    try {
        await uploader.connect();
       // const files = await getFilesFromDirectory(); // 웹 디렉토리 접근
        await uploader.validateFiles(fileList);
        console.log("모든 파일 전송 완료!");
      } catch(error) {
        console.error("전송 실패:", error);
      }



    //-------------------------------------------------------------------------//
   



    





    

    // console.log(`ver ${VERSION_JS}`);
    // await connectSerial(); // ESP32 연결

    // const fileList = await loadFileList();
    // if (fileList.length === 0) {
    //     console.log("❌ 전송할 파일이 없습니다.");
    //     return;
    // }

    // const fileUrl = BASE_URL + fileList[10]; // 첫 번째 파일 가져오기
    // const filePath = fileList[10]; // 상대 경로 유지

    // await new Promise(resolve => setTimeout(resolve, 100));

    // console.log(`🚀 테스트 파일 전송 시작: ${filePath} (버퍼 크기: ${BUFFER_SIZE} bytes)`);

    // let retryCount = 0;
    // let success = false;

    // await writer.write(new Uint8Array([0xee]));   // 전송 시작 신호
    // console.log("✔️ 전송 성공 [0xee] 파일 전송 시작 바이트");
    // await new Promise(resolve => setTimeout(resolve, 100));

    // //await writer.write(new Uint8Array([0x01])); // 파일 개수 전송 (1개)
    // await writer.write(new Uint32Array([0x01])); // 파일 개수 전송 (1개)
    // console.log(`✔️ 전송 성공: 1 개의 파일`);
    // await new Promise(resolve => setTimeout(resolve, 100));

    // while (retryCount < MAX_RETRIES_SEND && !success) 
    // {      
    //     if (retryCount > 0) 
    //     {
    //         console.warn(`📌 재전송 시도: ${retryCount}/${MAX_RETRIES_SEND}`);
    //     }

    //     // 파일 경로 길이 전송
    //     await writer.write(new Uint8Array(new Uint32Array([filePath.length]).buffer));
    //     console.log(`✔️ 전송 성공: ${filePath.length} 파일 길이`);
    //     await new Promise(resolve => setTimeout(resolve, 100));

    //     // 파일 경로 데이터 전송
    //     await writer.write(new TextEncoder().encode(filePath));
    //     console.log(`✔️ 전송 성공: ${filePath} 파일 이름`);
    //     await new Promise(resolve => setTimeout(resolve, 100));

      
    //     // 📌 파일 크기 확인 (서버 Content-Length)
    //     let fileData;
    //     try {
    //         fileData = await fetchFileWithRetry(fileUrl);
    //     } catch (error) {
    //         console.error(error);
    //         return;
    //     }

    //     // 파일 크기 전송 (4바이트)
    //     const fileSize = fileData.byteLength;
    //     console.log(`📥 최종 다운로드한 파일 크기: ${fileSize} bytes`);
    //     await writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));
    //     console.log(`✔️ 전송 성공: ${fileSize} 바이트 파일 크기`);
    //     await new Promise(resolve => setTimeout(resolve, 100));


    //     // 📌 파일 데이터 전송 (256 바이트씩 나누어 전송)
    //     let totalSent = 0;
    //     const fileArray = new Uint8Array(fileData);

    //     //console.log(`📤 파일 전송 시작: ${filePath}`);
    //     console.log(`📤 파일 전송 시작: ${filePath} (파일데이텀 텀: ${FILEDATA_TERM} ms)`);
    //     for (let i = 0; i < fileSize; i += BUFFER_SIZE) {
    //         const chunk = fileArray.slice(i, i + BUFFER_SIZE);
    //         await writer.write(chunk);
    //         await new Promise(resolve => setTimeout(resolve, 10));
    //         totalSent += chunk.length;

    //       // 진행률 표시
    //         const percent = Math.round((totalSent / fileSize) * 100);
    //         console.log(`📊 진행률: ${percent}% (${totalSent}/${fileSize} bytes)`);
    //     }

    //     console.log(`✅ 전송 완료: ${filePath}`);

    //     console.log(`❓ 수신 ACK 대기중`);

    //     // ESP32로부터 ACK 수신
    //     const { value } = await reader.read();
    //     const receivedByte = value[0]; 

    //     console.log(`📩 받은 ACK: 0x${receivedByte.toString(16).toUpperCase()}`); // hex 출력

    //     if (receivedByte === 0xE1) 
    //     { 
    //         console.log("✔️ 전송 성공");
    //         success = true;
    //     } 
    //     else 
    //     {
    //         if (receivedByte === 0xE2) 
    //         {
    //             console.warn("❌ 파일 바이트 부족 - 재전송 필요");
    //         } 
    //         else if (receivedByte === 0xE3) 
    //         {
    //             console.warn("❌ 파일 바이트 다름 - 재전송 필요");
    //         } 
    //         // else 
    //         // {
    //             console.warn("❌ 전송 오류 - 재전송 필요");
    //         //}
    //         retryCount++;
    //     }
    //     await new Promise(resolve => setTimeout(resolve, 100));
    // }
    // if (!success) 
    // {
    //     console.error("❌ 파일 전송 실패: 최대 재전송 횟수 초과");
    // }
}

async function SingleFileTransfer(fileUrl, filePath) 
{ 
    await new Promise(resolve => setTimeout(resolve, SEND_TERM));

    //console.log(`🚀 파일 전송 시작: ${filePath}`);
    console.log(`🚀 파일 전송 시작: ${filePath} (버퍼 크기: ${BUFFER_SIZE} bytes)`);

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

        console.log(`📤 파일 전송 시작: ${filePath} (파일데이텀 텀: ${FILEDATA_TERM} ms)`);
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
    const totalFiles = fileList.length;


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
    console.log(`🔍 파일 검증 시작: (전송 텀: ${SEND_TERM} ms)`);
   // console.log("🔍 파일 검증 시작...");
    await validateFilesOnESP32();
   
    console.log("🎉 모든 파일 전송 및 검증 완료!");

    const endTime = Date.now(); // ⏱ 전송 종료 시간 기록
    const elapsedTime = (endTime - startTime) / 1000; // 초 단위 변환
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = Math.round(elapsedTime % 60);

    console.log(`⏳ 총 소요 시간: ${minutes}분 ${seconds}초`);
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
    document.getElementById("progressBar").style.width = percent + "%";

    // 진행 상태 텍스트 업데이트
    document.getElementById("progressText").innerText =
        `📂 진행 중: ${currentIndex}/${totalFiles} 파일 완료 (${percent}%)\n` +
        `📝 현재 파일: ${filePath}`;
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
    await connectSerial(); // ESP32 연결

    document.getElementById("selectedfileStatus").innerText = "전송 중";

    const fileUrl = BASE_URL + selectedFile;
   // await sendFileToESP32(fileUrl, selectedFile, 0, 1); // 파일 전송 함수 실행
    await SingleFileTransfer(fileUrl, selectedFile);

    document.getElementById("selectedfileStatus").innerText = "전송 완료!";
});