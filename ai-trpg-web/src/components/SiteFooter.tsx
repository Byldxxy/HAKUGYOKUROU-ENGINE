import './SiteFooter.css';

const icpNumber = (import.meta.env.VITE_ICP_NUMBER || '沪ICP备2026032479号-1').trim();

export default function SiteFooter() {
  const policeNumber = (import.meta.env.VITE_POLICE_NUMBER || '沪公网安备31011502406905号').trim();

  return (
    <footer className="site-footer" aria-label="网站备案信息">
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
        {icpNumber}
      </a>
      <a href={`https://beian.mps.gov.cn/#/query/webSearch?code=${policeNumber.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
        {policeNumber}
      </a>
    </footer>
  );
}
