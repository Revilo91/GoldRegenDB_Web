import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import etikettendrucker from "../help/etikettendrucker.md?raw";

const HILFE_THEMEN = [{ id: "etikettendrucker", titel: "Etikettendrucker M220", text: etikettendrucker }];

export default function Hilfe() {
  return (
    <div className="hilfe-page">
      <div className="page-header">
        <div>
          <h2>Hilfe</h2>
          <p>Anleitungen zur Einrichtung</p>
        </div>
      </div>
      {HILFE_THEMEN.map((thema) => (
        <article key={thema.id} className="hilfe-artikel">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{thema.text}</ReactMarkdown>
        </article>
      ))}
    </div>
  );
}
