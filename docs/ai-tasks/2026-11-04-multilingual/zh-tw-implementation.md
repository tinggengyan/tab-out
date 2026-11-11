# 繁體中文詞典實作

## 變更

- `extension/locales/zh-TW.js`：獨立註冊完整 578 個產品詞條，不合併英文或簡體中文作為缺譯替代。
- `extension/_locales/zh_TW/messages.json`：新增繁體中文擴充功能說明；品牌名稱維持 Tab Out。

以既有簡體文案核對語意，使用系統 Foundation 字形轉換輔助初稿，再逐段檢查並調整台灣用語，例如分頁、視窗、專案、工作區、儲存、設定、金鑰、匯入／匯出、封存、還原、復原。人工調整模型內容傳送許可、表單排除、金鑰刪除、刪除紀錄、清空不可復原等訊息，避免改變安全語意。網頁標題、網址與模型輸出不在此詞典的翻譯範圍。

## 實際驗證

使用 Node 24.15.0 執行以下檢查：

1. 以 `node:vm` 載入最新主詞典與繁體詞典，比對英文與繁體完整鍵集合：**577 個鍵完全一致**。
2. 比對每個鍵的 `{placeholder}` 集合與出現次數：**完全一致**。
3. 所有值皆為非空字串。只有 `title.issue`、`title.pr`、`title.githubPages` 保留與英文相同的技術名稱格式。
4. 解析 `_locales/zh_TW/messages.json`，檢查 `appName`／`appDescription`：**通過**。
5. `/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node --check extension/locales/zh-TW.js`：**exit 0**。

原始檢查輸出：

```text
PASS: 577 Traditional Chinese keys; exact English key coverage, nonempty strings and interpolation placeholders; metadata valid.
Unchanged strings (technical names): title.issue, title.pr, title.githubPages
```

驗收修補：補上結果核取方塊的無障礙名稱 `memory.selectResult: 選取 {title}`，目前共 578 個鍵。再次檢查該詞條只含一個 `{title}` 插值，其他既有英文鍵全部涵蓋、占位符一致，並通過語法檢查。執行當下主詞典尚有 577 個鍵，主開發者正同步補上同名鍵，因此此處不宣稱尚未執行的 578 鍵最終整合檢查。

```text
PASS: memory.selectResult uses exactly {title}.
PASS: 578 Traditional Chinese keys; 577 current English keys covered; pending core keys: memory.selectResult.
```

## 邊界與未驗證事項

未修改主語言服務、其他 UI、既有文件或測試。未提交或發布。此為開發翻譯，尚未經母語使用者校訂；本子任務未執行瀏覽器操作與版面驗證，由主會話負責整合驗證。
