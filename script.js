let port;
let writer;
const BUFFER_SIZE = 256;

// GitHub Pages���� ���� ��� �������� (���� URL)
const FILE_LIST_URL = "https://raw.githubusercontent.com/your-username/your-repo/main/files.json";

async function fetchFileList() {
    try {
        const response = await fetch(FILE_LIST_URL);
        const files = await response.json();
        log(`?? �� ${files.length}���� ���� �߰�`);
        return files;
    } catch (error) {
        log("? ���� ����� �ҷ��� �� �����ϴ�.");
        return [];
    }
}

async function connectSerial() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 921600 });
        writer = port.writable.getWriter();
        log("? ESP32�� �����");
    } catch (error) {
        log("? ��Ʈ ���� ����");
    }
}

async function sendFile(filePath, fileData) {
    if (!writer) {
        log("?? ��Ʈ�� �������� �ʽ��ϴ�.");
        return;
    }

    const fileSize = fileData.length;
    log(`?? ���� ����: ${filePath} (${fileSize} bytes)`);

    // ���� ��� ���� ����
    await writer.write(new Uint8Array(new Uint32Array([filePath.length]).buffer));
    await writer.write(new TextEncoder().encode(filePath));

    // ���� ũ�� ����
    await writer.write(new Uint8Array(new Uint32Array([fileSize]).buffer));

    // ���� ������ ����
    let totalSent = 0;
    while (totalSent < fileSize) {
        const chunk = fileData.slice(totalSent, totalSent + BUFFER_SIZE);
        await writer.write(chunk);
        totalSent += chunk.length;
    }

    log(`? ���� �Ϸ�: ${filePath}`);
}

async function startFileTransfer() {
    if (!port) {
        log("?? ���� ��Ʈ�� �����ϼ���.");
        return;
    }

    const files = await fetchFileList();
    for (const filePath of files) {
        try {
            const response = await fetch(filePath);
            const fileData = new Uint8Array(await response.arrayBuffer());
            await sendFile(filePath, fileData);
        } catch (error) {
            log(`? ���� ����: ${filePath}`);
        }
    }

    log("?? ��� ���� ���� �Ϸ�!");
}

function log(message) {
    const logElement = document.getElementById("log");
    logElement.innerHTML += `<p>${message}</p>`;
    logElement.scrollTop = logElement.scrollHeight;
}

document.getElementById("connect").addEventListener("click", connectSerial);
document.getElementById("start").addEventListener("click", startFileTransfer);
