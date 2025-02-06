document.getElementById('connectButton').addEventListener('click', async () => {
    try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });

        const encoder = new TextEncoderStream();
        const writableStreamClosed = encoder.readable.pipeTo(port.writable);
        const writer = encoder.writable.getWriter();
        
        // GitHub���� ���� �ٿ�ε� �� ����
        fetch('https://raw.githubusercontent.com/user/repo/branch/file.txt')
            .then(response => response.text())
            .then(fileContent => {
                writer.write(fileContent);
                writer.releaseLock();
            })
            .catch(error => console.error('���� �ٿ�ε� ����:', error));
        
        // �ø��� ��Ʈ �ݱ�
        await writableStreamClosed;
        await port.close();
    } catch (error) {
        console.error('�ø��� ��Ʈ ����:', error);
    }
});