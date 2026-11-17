import '../studio/studio.css';

import Styles from '../studio/Styles';

/** Styles have their own section: #/styles lists them, #/styles/<id> is one style's page. */
export default function StylesPage() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Styles</h1>
          <p>How your videos look and get made: the built-in styles, your copies of them, and styles learned from reference videos.</p>
        </div>
      </div>
      <Styles />
    </div>
  );
}
