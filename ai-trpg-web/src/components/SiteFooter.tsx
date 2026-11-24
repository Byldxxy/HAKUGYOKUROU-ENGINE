import './SiteFooter.css';

const icpNumber = import.meta.env.VITE_ICP_NUMBER?.trim();
const policeNumber = import.meta.env.VITE_POLICE_NUMBER?.trim();

export default function SiteFooter() {
  if (!icpNumber && !policeNumber) return null;

  return (
    <footer className="site-footer" aria-label="网站备案信息">
      {icpNumber && (
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
          {icpNumber}
        </a>
      )}
      {policeNumber && (
        <a href={`https://beian.mps.gov.cn/#/query/webSearch?code=${policeNumber.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
          {policeNumber}
        </a>
      )}
    </footer>
  );
}
