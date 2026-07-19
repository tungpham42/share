import { Tag } from "antd";
import { GithubOutlined } from "@ant-design/icons";

const isRealCommit = __COMMIT_SHA__ !== "dev";
const shortSha = __COMMIT_SHA__.slice(0, 7);

export default function VersionBadge() {
  return (
    <div className="version-badge">
      {isRealCommit ? (
        <a
          href={`https://github.com/jaden0747/WebScreenSharing/commit/${__COMMIT_SHA__}`}
          target="_blank"
          rel="noreferrer"
        >
          <Tag
            icon={<GithubOutlined />}
            color="orange"
            style={{ cursor: "pointer", padding: "4px 10px", fontSize: "13px" }}
          >
            v.{shortSha}
          </Tag>
        </a>
      ) : (
        <Tag color="orange" style={{ padding: "4px 10px", fontSize: "13px" }}>
          dev build
        </Tag>
      )}
    </div>
  );
}
