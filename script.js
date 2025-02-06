document.getElementById('connectButton').addEventListener('click', async () => {
    try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });

        const encoder = new TextEncoderStream();
        const writableStreamClosed = encoder.readable.pipeTo(port.writable);
        const writer = encoder.writable.getWriter();
        
        // GitHub에서 파일 다운로드 및 전송
        fetch('https://raw.githubusercontent.com/user/repo/branch/file.txt')
            .then(response => response.text())
            .then(fileContent => {
                writer.write(fileContent);
                writer.releaseLock();
            })
            .catch(error => console.error('파일 다운로드 오류:', error));
        
        // 시리얼 포트 닫기
        await writableStreamClosed;
        await port.close();
    } catch (error) {
        console.error('시리얼 포트 오류:', error);
    }
});