# pi-dloop scripts

这个目录存放 `pi-dloop` 的本地验证脚本。

## 脚本

| 文件 | 说明 |
| --- | --- |
| `test-extension-rpc.py` | 使用隔离 `PI_CODING_AGENT_DIR` 和 `pi -e` 通过 RPC 验证扩展加载与命令注册。 |

## 运行

```bash
python3 scripts/test-extension-rpc.py
```
